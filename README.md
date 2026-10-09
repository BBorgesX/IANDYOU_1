# MeetSync — IANDYOU_1

Protótipo 0.2 para combinar a chegada de Bruno e Cleide a um destino fixo, com convite privado para cada aparelho. [Publicar no Render](https://render.com/deploy?repo=https://github.com/BBorgesX/IANDYOU_1) · [Configuração do Google e controle de custo](docs/RENDER.md).

## Fluxo do encontro

1. Quem convida escolhe o destino e informa somente sua origem e transporte. Pode autorizar **Usar meu GPS** ou digitar o endereço completo.
2. A outra pessoa abre o convite privado e escolhe sua própria origem e transporte no próprio aparelho. A permissão de GPS é individual; negá-la mantém a entrada manual disponível.
3. Cada pessoa confirma **Estou saindo agora** no seu aparelho. O outro recebe o horário recomendado de saída.
4. A tela mostra previsões, diferença de chegada e o nome de quem deverá esperar. Antes de qualquer saída, a comparação é identificada como **se os dois saírem agora**.
5. Posições novas de GPS são compartilhadas em janelas de 15 segundos; previsões são recalculadas a cada 2 minutos, dentro da cota. **Parar GPS** interrompe a localização neste aparelho; encerrar o encontro remove as posições compartilhadas e encerra o acompanhamento nos dois aparelhos.

## Transportes e endereço

Cada pessoa escolhe **carro, Uber, ônibus ou metrô**. Uber usa a previsão de carro com trânsito, sem tempo de espera pelo motorista, tarifa ou reserva. Para ônibus e metrô, o app envia a preferência ao Google e verifica os veículos das alternativas retornadas. Uma rota incompatível não é apresentada como o transporte escolhido; disponibilidade depende das linhas e horários fornecidos pelo Google.

Endereços podem ser digitados livremente. O autocompletar opcional do **Places API (New)** filtra locais no Brasil, começa após quatro caracteres e espera 700 ms após digitar. Permite seleção por mouse ou teclado; falha ou limite de sugestões preservam o endereço manual. IDs de lugares selecionados são usados nas consultas de rota; chaves ficam somente no servidor.

## Custo e ativação

As duas integrações ficam **desativadas por padrão**. Adicionar uma chave sozinho não ativa consultas.

| Variável no servidor | Função |
| --- | --- |
| GOOGLE_MAPS_API_KEY | Chave autorizada para Routes API |
| GOOGLE_ROUTES_ENABLED=true | Ativa consultas de rota |
| ROUTES_DAILY_LIMIT=20 | Limite local de tentativas para teste |
| ROUTE_REFRESH_SECONDS=120 | Intervalo mínimo entre cálculos automáticos |
| GOOGLE_PLACES_ENABLED=true | Ativa sugestões, após habilitar Places API (New) |
| PLACES_DAILY_LIMIT=20 | Limite local separado de sugestões |
| GOOGLE_PLACES_API_KEY | Opcional: chave separada de Places; vazio usa a chave de Maps |

Configure franquias e cotas no Google antes de ativar. Contadores locais limitam tentativas, inclusive falhas; não representam a fatura. No Render Free podem ser apagados após deploy/reinício, portanto não são garantia de custo zero. Ler o estado, observar o contador e enviar posições não chamam Google Routes. Atualizar previsões pode usar até duas consultas; mudar os dados pessoais usa uma; confirmar saída pode usar até três. O Blueprint mantém integrações desligadas e limites zero para a primeira publicação.

## Executar e validar

Requer **Node.js 24.5 ou superior**. Não há dependências de produção.

```sh
npm start
npm run check
npm test
npm run build
```

Porta padrão 3000; o Render fornece `PORT`. O servidor escuta em `0.0.0.0` e respeita o proxy de rede do ambiente. `/api/config` informa `prototypeVersion=0.2.0`, ativação e limites sem consultar Google ou expor chaves. Testes de API usam respostas controladas; nenhuma validação automatizada envia consultas reais ao Google.

Com Chromium instalado, `npm run test:browser` valida o fluxo em dois contextos de navegador separados e tela de celular, usando Node e DevTools sem instalar bibliotecas. Para outro executável, configure `CHROME_BIN`. Verifica permissão de GPS concedida/negada, fallback manual, sugestões por teclado, dados individuais, saída compartilhada, mudança de posição, diferença de chegada e encerramento. Os dados de localização e as respostas do provedor são controlados; este teste não valida a chave ou a cobertura real do Google.

`dist/MeetSync.html` reúne a interface; encontros entre aparelhos e rotas exigem o servidor. Uma chave salva no Codex não é transferida automaticamente ao Render. Para um serviço existente, publique **Manual Deploy → Deploy latest commit** e aguarde **Live**.

## Limitações do protótipo

Encontros ficam na memória por até 12 horas e se perdem quando o servidor reinicia. Os convites são privados: quem tem o link pode ver os dados e agir como aquele participante. GPS requer HTTPS, consentimento no aparelho e página ativa; não há garantia de acompanhamento em segundo plano. Recarregar a página não reativa o GPS automaticamente. Posições antigas não são tratadas como GPS recente.

Sem GPS durante a viagem, o app conserva a previsão anterior; atualize o endereço manualmente para recalcular a partir de onde está. A confirmação de chegada real não é automática. Avisos do sistema dependem do navegador e da permissão. Render Free pode suspender serviços sem tráfego; não há garantia de disponibilidade permanente. Preserve `.local/google-usage.json` e `.local/google-places-usage.json` em ambientes onde exista disco persistente.
