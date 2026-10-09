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

## Atualização 0.2 — GPS individual e sugestões de endereço

A criação exige somente a origem de quem convida. Quem recebe o convite escolhe carro, Uber, ônibus ou metrô e confirma a própria origem no seu aparelho. Pode usar **Usar meu GPS**, autorizando o navegador, ou digitar o endereço. Negar o GPS não impede o uso manual. Cada token só pode alterar os dados e a localização do seu próprio participante.

O GPS usa a API de localização do navegador, em HTTPS. Ativá-lo é opcional e compartilha a posição com a outra pessoa. Há um botão **Parar GPS**. Encerrar o encontro remove as posições compartilhadas e interrompe os observadores nos aparelhos conectados. Recarregar a página não reativa GPS automaticamente: autorize novamente pelo botão. O funcionamento em segundo plano depende do navegador; mantenha a página ativa.

Durante o encontro, posições novas são enviadas em janelas de 15 segundos. As rotas são recalculadas a cada **120 segundos**, compartilhando a mesma janela no servidor para que duas páginas não dupliquem a consulta. Cada atualização pode consultar até duas rotas e consome a cota de Routes. Alterar origem ou transporte consulta uma rota; confirmar saída pode usar até três. Se a cota acabar, as últimas previsões continuam visíveis e novas consultas ficam bloqueadas. A leitura do estado a cada 2,5 segundos não consulta Google.

Na viagem, um GPS antigo não é tratado como posição atual. Sem GPS, o app preserva a previsão anterior em vez de somar novamente todo o trajeto a cada atualização. Informe manualmente seu endereço atual quando precisar de uma nova previsão durante o caminho. A diferença de chegada indica pelo nome quem deve esperar; antes da primeira saída, a comparação é explicitamente **se os dois saírem agora**.

**Uber:** previsão de carro com trânsito; não inclui espera pelo motorista, tarifa ou reserva da corrida. **Ônibus/metrô:** a API prioriza o modo solicitado; o app verifica os veículos retornados e seleciona uma alternativa compatível. Se o Google só retornar outro transporte ou um percurso misto incompatível, informa que não há rota compatível, sem apresentar aquela previsão como ônibus ou metrô.

### Ativar o autocompletar do Google

O endereço manual continua funcionando sem sugestões. O autocompletar usa **Places API (New)**, separada de Routes API, com chamadas e cota próprias.

1. No mesmo projeto Google, habilite [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com).
2. Nas restrições da chave usada no Render, permita **Routes API** e **Places API (New)**. Opcionalmente, mantenha chaves separadas: adicione `GOOGLE_PLACES_API_KEY` no Render, autorizada somente para Places API (New). Se essa variável estiver vazia, o servidor usa `GOOGLE_MAPS_API_KEY`. No ambiente Codex, uma chave enviada pelo proxy precisa estar vinculada especificamente ao destino `places.googleapis.com`.
3. Verifique a franquia e ajuste as cotas de Places no Google. A [tabela oficial](https://developers.google.com/maps/billing-and-pricing/pricing), consultada em 09/10/2026, lista **10.000 Autocomplete Requests gratuitos por mês**, agregados por conta de faturamento. Cada chamada de sugestões conta separadamente; o app não faz Place Details e não promete cobrança por sessão. Alertas de orçamento não bloqueiam gastos.
4. No Render → Environment, adicione:

| Variável | Valor para o teste |
| --- | --- |
| GOOGLE_PLACES_ENABLED | true |
| PLACES_DAILY_LIMIT | 20 |
| ROUTE_REFRESH_SECONDS | 120 |

5. Salve e use **Manual Deploy → Deploy latest commit**. Em `/api/config`, verifique `prototypeVersion=0.2.0`, `placesConfigured=true` e `placesUsage.limit=20`. Este endpoint verifica configuração local, sem validar a chave no Google e sem consumir consultas.

As sugestões filtram locais no Brasil, começam com pelo menos quatro caracteres e aguardam 700 ms após a digitação. É possível selecionar com o mouse ou com as teclas de setas e Enter. Falhas, saldo zero ou integração desligada preservam a entrada manual. O Blueprint mantém `GOOGLE_PLACES_ENABLED=false` e `PLACES_DAILY_LIMIT=0` na instalação inicial para evitar ativação acidental. O contador Places tem as mesmas limitações do disco temporário do Render: não é um teto de fatura da conta Google.
