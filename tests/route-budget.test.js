import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteBudget } from '../src/services/route-budget.js';
import { createGoogleRoutes } from '../src/services/google-routes.js';
import { createServer } from '../server.js';

async function directory() { return pathToFileURL((await mkdtemp(join(tmpdir(), 'meetsync-budget-'))) + '/'); }

test('bloqueia excedente concorrente e preserva contagem após recriar o serviço', async () => {
 const dir=await directory();
 const budget=createRouteBudget({directory:dir,limit:2});
 const results=await Promise.allSettled(Array.from({length:5},()=>budget.reserve()));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 assert.equal(results.filter(r=>r.status==='rejected' && r.reason.status===429).length,3);
 const restored=createRouteBudget({directory:dir,limit:2});
 assert.equal((await restored.status()).used,2);
 await assert.rejects(()=>restored.reserve(),e=>e.status===429);
});
test('renova no dia da Bahia e permite pausar todas as chamadas com limite zero',async()=>{
 let time=Date.parse('2026-10-08T02:59:59Z');
 const dir=await directory();
 const budget=createRouteBudget({directory:dir,limit:1,now:()=>time});
 await budget.reserve();
 assert.equal((await budget.status()).day,'2026-10-07');
 time+=2000;
 assert.equal((await budget.status()).remaining,1);
 assert.equal((await budget.status()).day,'2026-10-08');
 const paused=createRouteBudget({directory:dir,limit:0,now:()=>time});
 await assert.rejects(()=>paused.reserve(),e=>e.status===429);
});
test('contador corrompido bloqueia a chamada ao Google',async()=>{
 const dir=await directory();
 await writeFile(new URL('google-usage.json',dir),'corrompido');
 let calls=0;
 const route=createGoogleRoutes({allowPaidRequests:true,apiKey:'test-only-key',budget:createRouteBudget({directory:dir}),fetchImpl:async()=>{calls++;return new Response('{}');}});
 await assert.rejects(()=>route({origin:'A',destination:'B',mode:'car',departureAt:Date.now()}),/contador/);
 assert.equal(calls,0);
});
test('falha do Google conta e a tentativa seguinte não é enviada ao atingir o limite',async()=>{
 const dir=await directory();
 const budget=createRouteBudget({directory:dir,limit:1});
 let calls=0;
 const route=createGoogleRoutes({allowPaidRequests:true,apiKey:'test-only-key',budget,fetchImpl:async()=>{calls++;throw new Error('Falha controlada');}});
 const input={origin:'A',destination:'B',mode:'car',departureAt:Date.now()};
 await assert.rejects(()=>route(input));
 await assert.rejects(()=>route(input),e=>e.status===429);
 assert.equal(calls,1);
 assert.equal((await budget.status()).used,1);
});
test('API recusa criação sem saldo para duas rotas antes de chamar o provedor',async t=>{
 const budget=createRouteBudget({directory:await directory(),limit:1});
 let calls=0;
 const server=createServer({configured:true,budget,getRoute:async()=>{calls++;return {durationSeconds:100};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/meetings`,{method:'POST',headers:{'Content-Type':'application/json','X-Meetsync-Client':'1'},body:'{}'});
 assert.equal(response.status,429);
 assert.equal(calls,0);
});
