# Spin Tecnologia — Checkout PagBank com Cobrança Recorrente

Landing page de emissão de Nota Fiscal com checkout de **cartão de crédito** integrado à **API do PagBank**, incluindo **cobrança recorrente mensal** (assinatura) e **webhooks** de confirmação de pagamento.

---

## 📁 Estrutura do projeto

```
.
├── index.html          # Landing page (formulário + fluxo de checkout)
├── server.js            # Backend Node.js / Express (API PagBank + webhooks)
├── package.json          # Dependências do Node.js
├── .env                  # Suas variáveis reais (NUNCA versionar — veja .gitignore)
└── img/
    ├── logo-spin.png     # Logotipo exibido na landing page
    └── icone-spin.jpg    # Favicon
```

---

## 🚀 Como funciona

```
Cliente preenche o formulário (index.html)
        │
        ▼
POST /criar-checkout  ──────────────►  server.js  ──────────────►  API do PagBank
        │                                                          (cria checkout +
        │                                                           plano de recorrência)
        ▼
Navegador é redirecionado para a página
de pagamento hospedada pelo PagBank
        │
        ▼
Cliente paga com cartão de crédito
        │
        ├──► PagBank chama POST /webhook/pagbank               (confirma o pagamento)
        ├──► PagBank chama POST /webhook/pagbank-assinaturas    (confirma a assinatura)
        │
        ▼
Cliente é redirecionado de volta para a
landing page (redirect_url), tela de sucesso
        │
        ▼
Todo mês, o PagBank cobra automaticamente e chama
POST /webhook/pagbank-assinaturas de novo (evento subscription.recurrence)
```

---

## 🛠️ Tecnologias utilizadas

- **Node.js** + **Express** — servidor/backend
- **API de Checkout do PagBank** (`/checkouts`) — criação do pagamento com cartão de crédito
- **Checkout Recorrente do PagBank** (`recurrence_plan`) — cobrança automática mensal
- **API de Pagamentos Recorrentes do PagBank** (`/preferences/notifications`) — configuração do webhook de assinaturas
- **dotenv** — variáveis de ambiente
- **cors** — permite a landing page chamar o backend
- **ngrok** — túnel HTTPS para testes locais (obrigatório: o PagBank exige HTTPS e não aceita `localhost`)

---

## ⚙️ Variáveis de ambiente

Entre em `.env` e preencha:

| Variável | Descrição |
|---|---|
| `PAGBANK_TOKEN` | Token da conta PagBank (gerado em Integrações → Tokens de API). **Use um token de uma conta de SANDBOX de desenvolvedor** para testes — um token de produção não funciona contra o ambiente de sandbox. |
| `PAGBANK_AMBIENTE` | `sandbox` (testes, sem cobrança real) ou `production` (cobrança real) |
| `MEU_DOMINIO` | URL pública deste servidor (a URL do ngrok em testes locais, ou a URL do Render em produção). É para onde o PagBank envia os webhooks. |
| `URL_RETORNO_CLIENTE` | Para onde o cliente volta depois de pagar. **Precisa ser HTTPS** — `http://localhost` é rejeitado pelo PagBank. |
| `VALOR_PRODUTO_REAIS` | Preço cobrado por ciclo, em reais (ex: `97.00`) |
| `NOME_PRODUTO` | Nome exibido na tela de pagamento do PagBank |
| `RECORRENCIA_ATIVA` | `true` para cobrar todo mês automaticamente, `false` para cobrança única |
| `NOME_PLANO_RECORRENTE` | Nome do plano de assinatura |
| `INTERVALO_UNIDADE` / `INTERVALO_DURACAO` | Intervalo entre cobranças (`MONTH` / `1` = todo mês) |
| `CICLOS_COBRANCA` | Número de cobranças até expirar. Deixe vazio para cobrar indefinidamente, até o cliente cancelar. |
| `WEBHOOK_PAGAMENTO_CONFIRMADO` | (Opcional) Webhook próprio (Make/Zapier/n8n) para repassar a confirmação de pagamento |
| `WEBHOOK_COBRANCA_RECORRENTE` | (Opcional) Webhook próprio para repassar cada cobrança mensal confirmada |

---

## 💻 Rodando localmente

### 1. Clonar e instalar

```bash
git clone <URL_DO_REPOSITORIO>
cd <pasta-do-projeto>
npm install
```

### 2. Configurar o `.env`

```bash
cp .env
```

Preencha o `PAGBANK_TOKEN` (de uma conta sandbox de desenvolvedor PagBank) e os demais campos.

### 3. Subir um túnel HTTPS com o ngrok

O PagBank exige URLs públicas em HTTPS para `redirect_url` e para os webhooks — por isso, mesmo em teste local, é preciso expor o servidor com o [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
```

Copie a URL gerada (algo como `https://xxxxx.ngrok-free.dev`) e cole em **duas** variáveis:

- `MEU_DOMINIO` e `URL_RETORNO_CLIENTE` (no `.env`)
- `URL_BACKEND` (no início do `<script>` do `index.html`)

⚠️ URLs de ngrok podem mudar a cada reinício — sempre que isso acontecer, atualize os dois lugares e reinicie o servidor.

### 4. Rodar o servidor

```bash
npm start
```

Você deve ver no terminal:
```
Servidor rodando na porta 3000 (ambiente PagBank: sandbox)
✅ URL de notificação de assinaturas configurada com sucesso na conta PagBank.
```

### 5. Abrir a landing page

Acesse `http://localhost:3000/index.html` (ou a URL do ngrok) no navegador, preencha o formulário e teste o pagamento.

---

## 💳 Testando pagamentos (sandbox)

Use os cartões de teste oficiais do PagBank:

| Bandeira | Número | CVV | Validade | Resultado |
|---|---|---|---|---|
| Mastercard | 5555 6666 7777 8884 | 123 | 12/2026 | Aprovado |
| Visa | 5322 3972 3765 3563 | 123 | 12/2026 | Aprovado |

---

## 🔁 Testando a cobrança recorrente (mês seguinte)

Para não precisar esperar 30 dias:

1. Acesse o **Painel de Assinaturas (sandbox)**: https://sandbox.assinaturas.pagseguro.uol.com.br/login
2. Localize a assinatura criada no seu teste (ID no formato `SUBS_...`)
3. Edite a **data da próxima cobrança** para hoje e salve
4. Aguarde o processamento (pode levar alguns minutos, não é sempre instantâneo)
5. Confira no terminal do servidor se chegou o evento `subscription.recurrence` — é a confirmação de que a cobrança do mês seguinte funcionou

---

## 🔌 Endpoints do servidor

| Rota | Método | O que faz |
|---|---|---|
| `/criar-checkout` | POST | Recebe os dados do formulário e cria o checkout (+ plano recorrente) no PagBank |
| `/webhook/pagbank` | POST | Recebe a confirmação de status do **pagamento** (evento da 1ª cobrança) |
| `/webhook/pagbank-assinaturas` | POST | Recebe os eventos da **assinatura** (criação, cobranças seguintes, cancelamento) |
| `/configurar-webhook-assinaturas` | POST | Registra manualmente a URL de notificação de assinaturas na conta PagBank (já roda automaticamente ao iniciar o servidor) |
| `/` , `/index.html` | GET | Serve a landing page |

---

## ⚠️ Pontos de atenção conhecidos

- **Ambiente sandbox vs. produção:** um token de conta real não funciona contra `sandbox.api.pagseguro.com`, e vice-versa. Confirme sempre qual token está usando.
- **`redirect_url` precisa ser HTTPS.** `http://localhost` é rejeitado pelo PagBank com o erro `invalid_value`.
- **`x-authenticity-token` nem sempre chega em sandbox.** É uma limitação relatada por outros desenvolvedores na comunidade do PagBank — por isso o endpoint `/webhook/pagbank` não bloqueia mais notificações sem esse header, apenas registra um aviso no log. Antes de ir para produção, vale conferir se o header passa a vir corretamente e, se quiser mais segurança, reativar o bloqueio.
- **O webhook de assinaturas é configurado por conta, não por checkout.** Diferente do webhook de pagamento (definido a cada checkout criado), a URL de notificação de assinaturas é única para toda a conta PagBank — reconfigurá-la troca o destino de **todas** as assinaturas.
- **Pagamentos Recorrentes em produção normalmente exigem homologação prévia** pelo time do PagBank antes de sair do sandbox.

---

## ☁️ Colocando em produção — passo a passo

Este passo a passo assume que os testes em sandbox (seções anteriores) já
funcionaram de ponta a ponta: pagamento aprovado, webhook de pagamento e
webhook de assinatura recebidos, e a cobrança recorrente do mês seguinte
confirmada.

### Passo 1 — Solicitar homologação para Pagamentos Recorrentes

O uso de cobrança recorrente em **produção** normalmente exige aprovação
prévia do time do PagBank (diferente do sandbox, que já funciona sem essa
aprovação).

1. Acesse sua conta real do PagBank (não a de sandbox)
2. Entre em contato com o time de Integrações/Suporte do PagBank e solicite a
   habilitação do produto **Pagamentos Recorrentes** para a sua conta
3. Aguarde a confirmação por e-mail antes de prosseguir — sem essa liberação,
   os checkouts com `recurrence_plan` podem falhar em produção mesmo com
   token e configuração corretos

### Passo 2 — Gerar o token de produção

1. Acesse **Minha Conta → Integrações → Tokens de API** na sua conta real do
   PagBank (não confundir com a conta de sandbox usada nos testes)
2. Gere um novo token, com o ambiente marcado como **produção**
3. Guarde esse token em local seguro — ele **não** deve ser commitado no
   Git nem compartilhado

### Passo 3 — Preparar o repositório

1. Confirme que o `.gitignore` está presente e contém `node_modules/` e `.env`
2. Confirme que **nenhum token real** está commitado em nenhum arquivo do
   repositório (revise o histórico de commits também, se algum token chegou
   a ser commitado por engano em algum momento)
3. Suba o projeto para o GitHub (ou GitLab):
   ```bash
   git add .
   git commit -m "Preparando para produção"
   git push
   ```

### Passo 4 — Criar o serviço no Render

1. Acesse [render.com](https://render.com) e faça login
2. **New +** → **Web Service**
3. Conecte o repositório do GitHub/GitLab
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Region:** de preferência a mais próxima do seu público
5. Ainda não finalize — primeiro configure as variáveis de ambiente (Passo 5)

### Passo 5 — Configurar as variáveis de ambiente de produção

Em **Environment**, cadastre (valores de produção, não os de teste):

| Variável | Valor em produção |
|---|---|
| `PAGBANK_TOKEN` | O token de produção gerado no Passo 2 |
| `PAGBANK_AMBIENTE` | `production` |
| `MEU_DOMINIO` | A URL pública que o Render atribuir ao serviço (ex: `https://spin-checkout.onrender.com`) — só é possível saber essa URL depois do primeiro deploy; pode editar essa variável e reiniciar o serviço depois |
| `URL_RETORNO_CLIENTE` | URL real da sua landing page em produção (ex: `https://spin-checkout.onrender.com/index.html#pago`, ou seu domínio próprio) |
| `VALOR_PRODUTO_REAIS` | Preço real cobrado |
| `RECORRENCIA_ATIVA` | `true` |
| `WEBHOOK_PAGAMENTO_CONFIRMADO` / `WEBHOOK_COBRANCA_RECORRENTE` | Webhooks reais de automação, se for usar |

Depois de salvar, clique em **Create Web Service** (ou **Manual Deploy**, se
o serviço já existir) para publicar.

### Passo 6 — Atualizar a URL do backend na landing page

1. Copie a URL pública que o Render gerou para o serviço
2. No `index.html`, atualize `URL_BACKEND` para essa URL
3. Se `MEU_DOMINIO` foi cadastrado com um valor provisório no Passo 5,
   atualize-o agora para a URL real e reinicie o serviço no Render (isso é
   necessário porque essa variável é usada para registrar as URLs de webhook
   junto ao PagBank)
4. Faça commit e push dessa alteração — o Render publica automaticamente a
   nova versão a cada push, se o deploy automático estiver ativado

### Passo 7 — Confirmar o registro dos webhooks

1. Abra os **logs** do serviço no painel do Render
2. Procure pela linha: `✅ URL de notificação de assinaturas configurada com
   sucesso na conta PagBank.`
3. Se aparecer erro nesse ponto, geralmente é sinal de que a homologação do
   Passo 1 ainda não foi concluída — confirme com o suporte do PagBank

### Passo 8 — Revisar a validação de assinatura dos webhooks

Durante os testes em sandbox, a validação do header `x-authenticity-token`
foi deixada permissiva (apenas registra um aviso, não bloqueia), porque esse
header nem sempre chega em sandbox. Em produção:

1. Faça um pagamento de teste real (de baixo valor) e confira, nos logs do
   Render, se o header `x-authenticity-token` chegou corretamente em
   `/webhook/pagbank`
2. Se estiver chegando de forma consistente e você quiser reforçar a
   segurança contra notificações falsas, volte a bloquear a requisição
   (`return res.status(401)...`) quando a assinatura não bater, no lugar do
   `console.warn` atual

### Passo 9 — Testar um ciclo completo em produção

1. Faça uma compra real de teste com um cartão válido (idealmente de baixo
   valor, ou reembolsável)
2. Confirme que:
   - o pagamento é aprovado
   - `/webhook/pagbank` recebe a confirmação
   - `/webhook/pagbank-assinaturas` recebe a criação da assinatura
   - a tela de sucesso aparece corretamente após o redirecionamento
3. Se possível, acompanhe se a cobrança do mês seguinte ocorre automaticamente
   (ou simule via painel de assinaturas, se o PagBank oferecer o mesmo
   recurso em produção)

### Passo 10 (opcional) — Domínio próprio e monitoramento

1. No painel do Render, em **Settings → Custom Domains**, adicione seu
   domínio (ex: `checkout.suaempresa.com.br`) e configure o DNS conforme
   instruído — o Render emite o certificado HTTPS automaticamente
2. Se usar domínio próprio, atualize novamente `MEU_DOMINIO`,
   `URL_RETORNO_CLIENTE` e `URL_BACKEND` para refletir o novo endereço
3. Configure alguma forma de monitoramento (o próprio painel de logs do
   Render, ou uma ferramenta externa) para acompanhar falhas de pagamento e
   quedas do serviço

---

## ✅ Checklist final de produção

- [ ] Conta PagBank homologada para Pagamentos Recorrentes
- [ ] Token de produção gerado e configurado em `PAGBANK_TOKEN`
- [ ] `PAGBANK_AMBIENTE=production`
- [ ] Nenhum token real commitado no repositório
- [ ] `MEU_DOMINIO`, `URL_RETORNO_CLIENTE` e `URL_BACKEND` apontando para URLs reais (não mais ngrok)
- [ ] Log confirma o registro do webhook de assinaturas na conta
- [ ] Validação de assinatura dos webhooks revisada (e reativada, se desejado)
- [ ] Compra de teste real aprovada, com os dois webhooks recebidos
- [ ] Ciclo de cobrança recorrente confirmado
- [ ] (Opcional) Domínio próprio configurado com HTTPS
- [ ] (Opcional) Monitoramento de logs/erros configurado

---

## 📜 Licença

Consulte o arquivo `LICENSE` deste repositório.
