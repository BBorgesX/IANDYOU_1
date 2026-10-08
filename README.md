# MeetSync — Bruno e Cleide

Hospedagem: [publicar no Render](https://render.com/deploy?repo=https://github.com/BBorgesX/IANDYOU_1) usando o blueprint `render.yaml`. Ele configura o plano Free e mantém consultas Google bloqueadas na validação inicial. [Instruções e limitações](docs/RENDER.md).

Encontros com ponto fixo, convites privados e confirmação de saída entre dois aparelhos.

## Estado atual e custo

O objetivo é um produto com cálculo automático inclusive para ônibus e metrô. O Google é uma opção aceita, mas o protótipo precisa controlar custos antes de habilitar consultas. **As consultas ao Google estão bloqueadas no servidor**, mesmo quando a chave está presente, antes de reservar quota ou fazer uma requisição. A interface ainda informa que uma alternativa gratuita está em preparação. A publicação inicial permite validar a hospedagem, mas não oferece cálculo de rotas reais enquanto a integração estiver bloqueada.

A próxima etapa da integração é verificar a franquia aplicável na conta Google e configurar cotas no provedor antes de liberar consultas. Uma alternativa sem Google para transporte público depende de dados oficiais da cidade, como feeds GTFS; sua disponibilidade ainda não foi verificada.

A proteção se aplica ao servidor atualizado. O bloqueio não altera outras cópias do aplicativo nem aplicativos no mesmo projeto Google.

## Executar e validar

Requer Node.js 24.5 ou superior. Nenhuma instalação de dependências:

```sh
npm start
npm test
npm run check
npm run build
```

Porta padrão: 3000; `PORT=3002 npm start` usa outra porta. O servidor utiliza o proxy de rede do ambiente quando houver. `/api/config` informa `paidGoogleDisabled: true` no servidor padrão. `npm test` usa respostas controladas; o teste do bloqueio confirma zero requisições e zero reservas de quota, mesmo com uma chave presente.

`dist/MeetSync.html` reúne a interface, mas o encontro entre aparelhos requer servidor. Não há publicação pública automática. Hospedagem gratuita e disponibilidade permanente não são garantias equivalentes; cada serviço tem suas próprias limitações.

## Funcionamento compartilhado já implementado

Um encontro tem duas origens, destino fixo e transportes. Cada participante possui convite privado separado. A confirmação de saída é propagada por consulta de estado a cada 2,5 segundos. O contador usa horário do servidor. Sessões podem ser retomadas após recarregar a página e encerradas para os dois participantes.

As sessões ficam na memória por até 12 horas e se perdem ao reiniciar. Avisos do sistema dependem do navegador e de permissão; a página deve permanecer aberta. Não há acompanhamento por GPS contínuo. Os convites são privados: quem tem o link pode ver os dados e agir como aquele participante.

## Integração anterior do Google

O adaptador permanece isolado em `src/services/google-routes.js` para referência e testes. Por padrão ele bloqueia chamadas pagas; **não habilite `allowPaidRequests` em produção**. Os testes que usam esse parâmetro só trabalham com provedores controlados, sem enviar requisições ao Google.

O contador anterior continua preservado em `.local/google-usage.json`; não apague esse histórico. Ele mede tentativas do aplicativo, não a fatura do Google. A chave salva no ambiente não é necessária enquanto o Google permanecer bloqueado.
