import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' });
export class BudgetError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
export function createRouteBudget({
  directory = new URL('../../.local/', import.meta.url),
  limit = Number(process.env.ROUTES_DAILY_LIMIT ?? 20),
  now = Date.now,
  filename = 'google-usage.json',
} = {}) {
  // O contador não contém endereços, tokens ou chaves. Falhas bloqueiam consultas.
  if (!/^[a-z-]+\.json$/.test(filename)) throw new BudgetError('Nome do contador inválido.');
  const stem = filename.slice(0, -5);
  const file = new URL(filename, directory);
  const lock = new URL(stem + '.lock/', directory);
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000) throw new BudgetError('ROUTES_DAILY_LIMIT deve ser um inteiro entre 0 e 1000.');
  async function transaction(amount) {
    let locked = false;
    try {
      await mkdir(directory, { recursive: true });
      for (let attempt = 0; attempt < 20; attempt++) {
        try { await mkdir(lock); locked = true; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!locked) throw new BudgetError('Contador de consultas ocupado. Nenhuma nova consulta foi enviada ao Google.');
      const day = DAY.format(now());
      let state = { day, used: 0 };
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (typeof saved.day !== 'string' || !Number.isSafeInteger(saved.used) || saved.used < 0) throw new Error('Contador inválido');
        if (saved.day === day) state = saved;
      } catch (error) { if (error.code !== 'ENOENT') throw new BudgetError('Não foi possível verificar o contador. Novas consultas ao Google estão bloqueadas.'); }
      if (amount && state.used + amount > limit) throw new BudgetError(`Limite diário de ${limit} consultas atingido. Nenhuma nova consulta foi enviada ao Google.`, 429);
      if (amount) {
        state.used += amount;
        const temporary = new URL(`${stem}-${randomBytes(8).toString('hex')}.tmp`, directory);
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, file);
      }
      return { day, used: state.used, limit, remaining: Math.max(0, limit - state.used), timeZone: 'America/Bahia' };
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('Não foi possível salvar o contador de consultas. Nenhuma nova consulta foi enviada ao Google.');
    } finally { if (locked) await rmdir(lock); }
  }
  return { reserve: () => transaction(1), status: () => transaction(0) };
}

export const routeBudget = createRouteBudget();
export const placesBudget = createRouteBudget({ filename: 'google-places-usage.json', limit: Number(process.env.PLACES_DAILY_LIMIT ?? 0) });
