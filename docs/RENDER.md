# Publicar o protótipo no Render

O arquivo `render.yaml` na raiz configura o serviço Node no plano Free, na branch main, com build, inicialização e health check. A publicação depende de o código estar no GitHub e de uma conta Render autorizada a acessar o repositório.

## Publicar com a configuração pronta

Abra [publicar MeetSync no Render](https://render.com/deploy?repo=https://github.com/BBorgesX/IANDYOU_1). Entre na sua conta Render, autorize o acesso ao repositório quando solicitado e revise a configuração do Blueprint. Confirme que o serviço usa **Free** antes de aplicar. Se o repositório for privado, conecte a conta GitHub que tem acesso a ele. Como alternativa, use New → Blueprint e selecione BBorgesX/IANDYOU_1.

Não envie `.env`, `.local`, arquivos com chaves ou senhas, nem credenciais em commits. A configuração inicial não precisa da chave Google.

## Criar o serviço

No dashboard do Render, clique em New → Web Service. Conecte GitHub e escolha BBorgesX/IANDYOU_1. Use:

| Campo | Valor |
| --- | --- |
| Name | meetsync |
| Language/Runtime | Node |
| Branch | main |
| Root Directory | deixar vazio, com os arquivos na raiz |
| Build Command | npm run build |
| Start Command | npm start |
| Instance Type | Free, se disponível na conta |
| Health Check Path | /api/config |

Em Environment, adicione NODE_VERSION=24.19.0 e ROUTES_DAILY_LIMIT=0. Não configure PORT manualmente: o Render fornece essa variável e o servidor já escuta em 0.0.0.0. A chave de Google configurada no ambiente Codex não é transferida automaticamente ao Render.

Clique em Create Web Service. Aguarde o build/deploy terminar com status Live. Abra o endereço onrender.com mostrado no próprio serviço; não há um endereço reservado que possamos inventar antes de criar o serviço.

O Blueprint prepara esses mesmos campos automaticamente. O arquivo não cria um serviço sem autenticação e aplicação na conta Render.

## Disponibilidade

O plano Free suspende serviços web após 15 minutos sem tráfego de entrada e pode demorar para iniciar na próxima visita. Não há uma configuração no plano Free que garanta funcionamento contínuo. Para o protótipo, abra o aplicativo antes de iniciar um teste e mantenha a página aberta durante o encontro. A publicação inicial não configura serviços externos de ping nem muda para um plano pago.

## Estado funcional e custo

A configuração inicial publica a interface com **Google bloqueado e limite de consultas zero**. A interface informa essa condição. Ela não habilita o cálculo de rotas automaticamente: a liberação da integração é uma etapa posterior à verificação da franquia e do limite de gasto. Colar uma chave no Render, sozinho, não remove o bloqueio atual do código.

Não escolha uma instância paga para esta validação. Verifique os termos/plano apresentados na sua conta. O serviço gratuito pode dormir, demorar a acordar e reiniciar. Os encontros desta versão ficam na memória e se perdem ao reiniciar. O disco local do serviço gratuito não deve ser tratado como persistente: o contador local de consultas também pode ser perdido. Por isso ele não substitui cotas na conta do Google, e o primeiro deploy mantém limite zero.

Para validar a hospedagem, carregue a página e /api/config. Esses acessos não consultam o Google. O JSON deve mostrar paidGoogleDisabled=true e routeUsage.limit=0.
