# MeetSync — Bruno e Cleide

Hospedagem: [publicar no Render](https://render.com/deploy?repo=https://github.com/BBorgesX/IANDYOU_1) usando o blueprint `render.yaml`. Ele configura o plano Free e mantém consultas Google bloqueadas na validação inicial. [Instruções e limitações](docs/RENDER.md).

Encontros com ponto fixo, convites privados e confirmação de saída entre dois aparelhos.

## Estado atual e custo

O protótipo calcula rotas automáticas de carro, caminhada e transporte público com Google Routes quando a integração está configurada. **Consultas ficam desativadas por padrão**, mesmo com chave presente. A ativação exige `GOOGLE_ROUTES_ENABLED=true`, `GOOGLE_MAPS_API_KEY` no servidor e saldo no limite `ROUTES_DAILY_LIMIT`. [Ativação e controle de custo no Render](docs/RENDER.md#ativar-google-maps-para-um-teste-pequeno).

Para o teste, configure cotas no projeto Google antes de liberar consultas. O contador local não é um limite de faturamento: no Render Free ele pode ser apagado após reiniciar ou publicar. A disponibilidade de ônibus e metrô depende dos dados do Google na região. Não há promessa de custo zero nem de acompanhamento contínuo por GPS.

A proteção se aplica ao servidor atualizado. O bloqueio não altera outras cópias do aplicativo nem aplicativos no mesmo projeto Google.

## Executar e validar

Requer Node.js 24.5 ou superior. Nenhuma instalação de dependências:

```sh
npm start
npm test
npm run check
npm run build
```

Porta padrão: 3000; `PORT=3002 npm start` usa outra porta. O servidor utiliza o proxy de rede do ambiente quando houver. `/api/config` informa `paidGoogleDisabled: true` enquanto a ativação estiver desligada ou não houver chave. `npm test` usa respostas controladas, incluindo a integração HTTP de carro e transporte público; os testes de bloqueio confirmam zero consultas com chave presente sem ativação, sem chave ou com limite zero.

`dist/MeetSync.html` reúne a interface, mas o encontro entre aparelhos requer servidor. Não há publicação pública automática. Hospedagem gratuita e disponibilidade permanente não são garantias equivalentes; cada serviço tem suas próprias limitações.

## Funcionamento compartilhado já implementado

Um encontro tem duas origens, destino fixo e transportes. Cada participante possui convite privado separado. A confirmação de saída é propagada por consulta de estado a cada 2,5 segundos. O contador usa horário do servidor. Sessões podem ser retomadas após recarregar a página e encerradas para os dois participantes.

As sessões ficam na memória por até 12 horas e se perdem ao reiniciar. Avisos do sistema dependem do navegador e de permissão; a página deve permanecer aberta. Não há acompanhamento por GPS contínuo. Os convites são privados: quem tem o link pode ver os dados e agir como aquele participante.

## Integração do Google

O adaptador em `src/services/google-routes.js` usa Google Routes v2 Compute Routes. O servidor só libera consultas quando a variável de ativação é exatamente `true`; adicionar a chave, sozinho, não é suficiente. As consultas incluem duração, distância e trânsito para carro. O corpo e os cabeçalhos de autenticação ficam no servidor. Não configure chaves no código ou em arquivos enviados ao GitHub.

O contador fica em `.local/google-usage.json`; preserve esse histórico. Ele mede tentativas do aplicativo, não a fatura do Google. A chave salva neste ambiente não é transferida automaticamente ao Render.
