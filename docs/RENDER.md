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

Em Environment, adicione NODE_VERSION=24.19.0, GOOGLE_ROUTES_ENABLED=false e ROUTES_DAILY_LIMIT=0 para validar a hospedagem sem consultar rotas. O Render fornece PORT e o servidor já escuta em 0.0.0.0. A chave de Google configurada no ambiente Codex não é transferida automaticamente ao Render.

Clique em Create Web Service. Aguarde o build/deploy terminar com status Live. Abra o endereço onrender.com mostrado no próprio serviço; não há um endereço reservado que possamos inventar antes de criar o serviço.

O Blueprint prepara esses mesmos campos automaticamente. O arquivo não cria um serviço sem autenticação e aplicação na conta Render.

## Disponibilidade

O plano Free suspende serviços web após 15 minutos sem tráfego de entrada e pode demorar para iniciar na próxima visita. Não há uma configuração no plano Free que garanta funcionamento contínuo. Para o protótipo, abra o aplicativo antes de iniciar um teste e mantenha a página aberta durante o encontro. A publicação inicial não configura serviços externos de ping nem muda para um plano pago.

## Estado funcional e custo

A configuração inicial publica a interface com **Google bloqueado e limite de consultas zero**. Colar uma chave, sozinho, não ativa consultas. Para testar rotas reais, siga a ativação abaixo.

Não escolha uma instância paga para esta validação. Verifique os termos/plano apresentados na sua conta. O serviço gratuito pode dormir, demorar a acordar e reiniciar. Os encontros desta versão ficam na memória e se perdem ao reiniciar. O disco local do serviço gratuito não deve ser tratado como persistente: o contador local de consultas também pode ser perdido. Por isso ele não substitui cotas na conta do Google, e o primeiro deploy mantém limite zero.

Para validar a hospedagem, carregue a página e /api/config. Esses acessos não consultam o Google. O JSON deve mostrar paidGoogleDisabled=true e routeUsage.limit=0.

## Ativar Google Maps para um teste pequeno

1. No [Google Cloud](https://console.cloud.google.com/apis/library/routes.googleapis.com), selecione o projeto da sua chave e habilite **Routes API**. Essa API requer faturamento habilitado, mesmo com franquia gratuita.
2. Em [APIs e serviços → Routes API → Cotas](https://console.cloud.google.com/apis/api/routes.googleapis.com/quotas), configure um limite diário de **20 consultas de Compute Routes**, se essa cota estiver disponível. Se a conta só oferecer limites por minuto, eles não substituem um limite diário: mantenha a integração desativada até verificar como controlar o gasto no projeto. Alertas de orçamento apenas avisam; não interrompem automaticamente o uso.
3. Em [Credenciais](https://console.cloud.google.com/apis/credentials), restrinja a chave à **Routes API**. Esta chave é utilizada no servidor; restrições por referenciador de site não são adequadas para essas chamadas. Não publique a chave no GitHub, em HTML ou neste chat.
4. No Render, em **Environment**, configure:

| Variável | Valor |
| --- | --- |
| GOOGLE_MAPS_API_KEY | sua chave, no campo de variável do Render |
| GOOGLE_ROUTES_ENABLED | true |
| ROUTES_DAILY_LIMIT | 20 |

5. Salve as variáveis e publique o código mais recente. Em um serviço existente, use **Manual Deploy → Deploy latest commit**, pois o Blueprint desativa publicação automática. Aguarde **Live**.

Ao abrir `/api/config`, espere `googleMapsConfigured=true`, `googleRoutesEnabled=true`, `paidGoogleDisabled=false` e `routeUsage.limit=20`. Esse endpoint não consulta o Google e nunca retorna a chave. Ele verifica a configuração local, não valida a chave no provedor; a primeira criação de encontro verifica o acesso real e consome até duas consultas.

**Franquia:** a [tabela oficial](https://developers.google.com/maps/billing-and-pricing/pricing), consultada em 08/10/2026, mostra 10.000 eventos mensais gratuitos para Compute Routes Essentials e 5.000 para Compute Routes Pro. O app usa Pro para carro com trânsito. Vinte consultas por dia representam até 620 em um mês de 31 dias. A franquia considera o uso agregado dos projetos da mesma conta de faturamento para cada SKU; confira o consumo existente antes de ativar. Isto não garante uma conta de valor zero.

O contador do aplicativo limita tentativas desta instância, inclusive falhas. No Render Free, reinícios ou deploys podem apagar o arquivo de contagem; por isso a cota no Google é necessária. Abrir a página, ler o encontro, acompanhar o contador e consultar `/api/config` não enviam novos pedidos de rota. Criar um encontro usa 2; a primeira saída pode usar até 3; a segunda usa 1.

Para interromper consultas, configure `GOOGLE_ROUTES_ENABLED=false` ou `ROUTES_DAILY_LIMIT=0` no Render e aplique as variáveis. Para impedir imediatamente o uso por qualquer cópia, desative a chave ou a API no Google.

## Teste com Bruno e Cleide

Abra o endereço `.onrender.com`, preencha endereços completos com cidade, destino comum e transportes. Crie o encontro como Bruno, envie o convite privado para Cleide e abra esse convite no outro aparelho. Confirme **Estou saindo agora** apenas no aparelho da pessoa que saiu. O outro aparelho recebe automaticamente a atualização e o horário recomendado de saída. Transporte público depende das rotas e horários disponíveis no Google para a região.
