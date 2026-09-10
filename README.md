# Spin Tecnologia — Checkout PagBank com Cobrança Recorrente

Landing page de emissão de Nota Fiscal com checkout de **cartão de crédito** integrado à **API do PagBank**, incluindo **cobrança recorrente mensal** (assinatura) e **webhooks** de confirmação de pagamento.

---

## 📁 Estrutura do projeto

```
.
├── index.html          # Landing page (formulário + fluxo de checkout)
├── server.js            # Backend Node.js / Express (API PagBank + webhooks)
├── package.json          # Dependências do Node.js
├── .env.example          # Modelo das variáveis de ambiente
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

Copie `.env.example` para `.env` e preencha:

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
cp .env.example .env
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

## ☁️ Deploy no Render

1. Suba o projeto (sem a pasta `node_modules` e sem o `.env`) para um repositório GitHub/GitLab
2. No [Render](https://render.com): **New +** → **Web Service** → conecte o repositório
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. Em **Environment**, cadastre todas as variáveis listadas na seção acima (usando a URL pública que o Render vai gerar em `MEU_DOMINIO`)
6. Atualize o `URL_BACKEND` no `index.html` para a URL do Render

---

## ✅ Checklist antes de ir para produção

- [ ] Conta PagBank homologada para Pagamentos Recorrentes
- [ ] `PAGBANK_TOKEN` de produção configurado
- [ ] `PAGBANK_AMBIENTE=production`
- [ ] `MEU_DOMINIO`, `URL_RETORNO_CLIENTE` e `URL_BACKEND` apontando para URLs reais (não mais ngrok)
- [ ] Validação de assinatura dos webhooks revisada/reativada, se desejar mais segurança
- [ ] Teste completo de um ciclo de cobrança recorrente

---

## 📜 Licença

Consulte o arquivo `LICENSE` deste repositório.
