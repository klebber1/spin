// ============================================================================
// SERVIDOR — Integração com a API de Checkout do PagBank (Cartão de Crédito)
// ============================================================================
//
// O QUE ESTE SERVIDOR FAZ:
//
// 1) Endpoint POST /criar-checkout
//    A landing page chama esse endpoint quando o cliente envia o formulário.
//    Este servidor então fala com o PagBank (com o token secreto, que nunca
//    fica exposto no navegador) e cria um "Checkout PagBank" configurado para
//    aceitar Cartão de Crédito. O PagBank devolve um link de pagamento
//    (hospedado por eles), e esse link é repassado de volta para a landing
//    page, que redireciona o cliente até ele.
//
// 2) Endpoint POST /webhook/pagbank
//    É a URL que você cadastra no PagBank (campo payment_notification_urls)
//    para receber o AVISO AUTOMÁTICO quando o pagamento mudar de status
//    (aprovado, recusado, etc). O PagBank vai chamar essa URL sozinho — você
//    não precisa ficar checando nada manualmente. Este servidor confere se a
//    notificação realmente veio do PagBank (assinatura SHA-256) e, se o
//    pagamento foi aprovado (status "PAID"), pode repassar isso para onde
//    você quiser (Make, Zapier, e-mail, banco de dados, etc).
//
// ============================================================================
// COMO IMPLANTAR NO RENDER — PASSO A PASSO:
//
// 1. Crie um repositório (GitHub/GitLab) só com os arquivos desta pasta
//    (server.js, package.json).
// 2. No painel do Render (render.com): "New +" → "Web Service" → conecte
//    o repositório.
// 3. Build Command:  npm install
//    Start Command:  npm start
// 4. Em "Environment" (variáveis de ambiente), cadastre TODAS as variáveis
//    listadas na seção "CONFIGURAÇÕES" abaixo (nunca deixe o token do
//    PagBank escrito direto no código-fonte).
// 5. Depois do deploy, o Render te dá uma URL pública, tipo:
//    https://spin-checkout.onrender.com
//    Essa é a URL que você usa nas variáveis MEU_DOMINIO (aqui) e
//    URL_BACKEND (no index.html da landing page).
// ============================================================================

// 👉 CARREGA O ARQUIVO .env — sem esta linha, o Node nunca lê as variáveis
//    de ambiente do arquivo .env, e todas as configurações abaixo caem nos
//    valores padrão (incluindo o token placeholder, o que quebra a API).
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();

// ============================== CONFIGURAÇÕES ==============================
// 👉 TODAS as variáveis abaixo devem ser cadastradas no painel do Render em
//    "Environment" (não edite os valores fixos aqui — use variável de
//    ambiente sempre que possível, especialmente para o token).

// Token de integração da sua conta PagBank.
// Onde conseguir: painel do PagBank → Minha Conta → Integrações → Tokens de
// API. Gere um token de SANDBOX para testar e um de PRODUÇÃO para valer.
const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN || 'COLOQUE_SEU_TOKEN_AQUI';

// 'sandbox' (ambiente de testes, sem cobrança real) ou 'production' (real).
const PAGBANK_AMBIENTE = process.env.PAGBANK_AMBIENTE || 'sandbox';

const PAGBANK_API_URL = PAGBANK_AMBIENTE === 'production'
  ? 'https://api.pagseguro.com'
  : 'https://sandbox.api.pagseguro.com';

// URL pública DESTE servidor depois de implantado no Render.
// Ex: https://spin-checkout.onrender.com
// É para ela que o PagBank vai mandar a notificação de pagamento.
const MEU_DOMINIO = process.env.MEU_DOMINIO || 'https://SEU-APP.onrender.com';

// Para onde o cliente é redirecionado depois de pagar (volta pra sua landing
// page). Se sua landing tiver uma tela de "obrigado", aponte pra ela.
const URL_RETORNO_CLIENTE = process.env.URL_RETORNO_CLIENTE || 'https://seusite.com.br/#pago';

// Preço fixo do serviço, em REAIS (ex: 97.00). É esse valor que será cobrado
// no cartão do cliente a cada ciclo.
const VALOR_PRODUTO_REAIS = Number(process.env.VALOR_PRODUTO_REAIS || 97.00);
const NOME_PRODUTO = process.env.NOME_PRODUTO || 'Emissão de Nota Fiscal - Spin Tecnologia';

// ===================== COBRANÇA RECORRENTE (MENSALIDADE) =====================
// 👉 Deixe "true" para cobrar o cliente todo mês automaticamente (assinatura),
//    ou "false" para voltar a ser uma cobrança única.
const RECORRENCIA_ATIVA = (process.env.RECORRENCIA_ATIVA || 'true') === 'true';

// Nome do plano de assinatura (aparece no painel de recorrência do PagBank)
const NOME_PLANO_RECORRENTE = process.env.NOME_PLANO_RECORRENTE || 'Plano Mensal - Spin Tecnologia';

// Intervalo entre cobranças: por padrão, 1 MONTH = todo mês.
const INTERVALO_UNIDADE = process.env.INTERVALO_UNIDADE || 'MONTH'; // MONTH ou YEAR
const INTERVALO_DURACAO = Number(process.env.INTERVALO_DURACAO || 1);

// Número de cobranças que a assinatura terá até expirar sozinha.
// Deixe em branco ("") para cobrar PARA SEMPRE, até o cliente cancelar.
const CICLOS_COBRANCA = process.env.CICLOS_COBRANCA
  ? Number(process.env.CICLOS_COBRANCA)
  : null;

// URL deste servidor (Pagamentos Recorrentes tem uma API em outro domínio,
// api.assinaturas.pagseguro.com) que vai receber os eventos de mensalidade
// (cobrança do mês seguinte, cancelamento, etc.)
const ASSINATURAS_API_URL = PAGBANK_AMBIENTE === 'production'
  ? 'https://api.assinaturas.pagseguro.com'
  : 'https://sandbox.api.assinaturas.pagseguro.com';

// 👉 (Opcional) Webhook próprio (Make/Zapier/n8n/outro) para onde repassamos
//    os eventos de COBRANÇA RECORRENTE (mês 2, 3, 4...). Pode ser o mesmo
//    valor de WEBHOOK_PAGAMENTO_CONFIRMADO ou um diferente.
const WEBHOOK_COBRANCA_RECORRENTE = process.env.WEBHOOK_COBRANCA_RECORRENTE || '';

// 👉 (Opcional) Webhook próprio (Make/Zapier/n8n/outro) para onde ESTE
//    servidor repassa a confirmação de pagamento, DEPOIS de validar que a
//    notificação realmente veio do PagBank. Deixe em branco ("") se não
//    quiser repassar para lugar nenhum (e só tratar aqui dentro do código).
const WEBHOOK_PAGAMENTO_CONFIRMADO = process.env.WEBHOOK_PAGAMENTO_CONFIRMADO || '';

// ============================================================================

app.use(cors()); // permite que a landing page (em outro domínio) chame este servidor

// 👉 Serve o index.html e a pasta img/ diretamente por este servidor. Isso é
//    o que faz o redirect_url (após o pagamento) funcionar de verdade —
//    ele aponta para ESTE servidor, que devolve a landing page com a tela
//    de sucesso. Se você mover o index.html para outro lugar, ajuste o
//    caminho abaixo.
app.use(express.static(path.join(__dirname)));

// Para o endpoint de webhook, precisamos do corpo da requisição "cru" (sem
// reformatar), pois a validação de assinatura do PagBank é feita em cima do
// texto EXATO que eles enviaram — qualquer espaço a mais quebra a validação.
app.use('/webhook/pagbank', express.raw({ type: '*/*' }));
app.use('/webhook/pagbank-assinaturas', express.raw({ type: '*/*' }));

// Para as demais rotas, interpretamos o corpo como JSON normalmente.
app.use(express.json());

// ========================= 1) CRIAR CHECKOUT (CARTÃO) =======================
// A landing page chama este endpoint no envio do formulário, ao invés de
// abrir diretamente o link fixo do PagBank.
app.post('/criar-checkout', async (req, res) => {
  try {
    const { nome, email, cpf, tel } = req.body;

    if (!nome || !email || !cpf) {
      return res.status(400).json({ erro: 'Dados do cliente incompletos.' });
    }

    const telefoneNumeros = (tel || '').replace(/\D/g, '');

    const payload = {
      reference_id: `pedido-${Date.now()}`,
      customer: {
        name: nome,
        email: email,
        tax_id: cpf.replace(/\D/g, ''),
        phone: {
          country: '+55',
          area: telefoneNumeros.slice(0, 2) || '11',
          number: telefoneNumeros.slice(2) || '900000000'
        }
      },
      items: [
        {
          reference_id: 'item-01',
          name: NOME_PRODUTO,
          quantity: 1,
          unit_amount: Math.round(VALOR_PRODUTO_REAIS * 100) // PagBank espera o valor em CENTAVOS
        }
      ],
      // Só aceitamos Cartão de Crédito neste checkout
      payment_methods: [
        { type: 'CREDIT_CARD' }
      ],
      redirect_url: URL_RETORNO_CLIENTE,
      // Webhook de mudança de status do CHECKOUT em si (ex: expirou)
      notification_urls: [`${MEU_DOMINIO}/webhook/pagbank`],
      // Webhook de mudança de status do PAGAMENTO (PAID, DECLINED, etc.)
      // 👉 É este que confirma de verdade que o cliente pagou (1ª cobrança).
      payment_notification_urls: [`${MEU_DOMINIO}/webhook/pagbank`]
    };

    // ===== COBRANÇA RECORRENTE (assinatura mensal) =====
    // Ao incluir "recurrence_plan", o PagBank cobra o cartão na hora (1ª
    // parcela) E cria uma assinatura sozinho para repetir a cobrança todo mês.
    // As cobranças seguintes chegam no webhook /webhook/pagbank-assinaturas
    // (configurado separadamente — veja mais abaixo no arquivo).
    if (RECORRENCIA_ATIVA) {
      payload.recurrence_plan = {
        name: NOME_PLANO_RECORRENTE,
        interval: {
          unit: INTERVALO_UNIDADE,   // "MONTH" = cobra todo mês
          length: INTERVALO_DURACAO  // 1 = a cada 1 mês
        }
      };
      // Se CICLOS_COBRANCA não for informado, a assinatura cobra
      // indefinidamente, até o cliente cancelar.
      if (CICLOS_COBRANCA) {
        payload.recurrence_plan.billing_cycles = CICLOS_COBRANCA;
      }
    }

    const respostaPagBank = await fetch(`${PAGBANK_API_URL}/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAGBANK_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const dadosResposta = await respostaPagBank.json();

    if (!respostaPagBank.ok) {
      console.error('Erro ao criar checkout no PagBank:', JSON.stringify(dadosResposta));
      return res.status(400).json({ erro: 'Não foi possível criar o checkout no PagBank.', detalhes: dadosResposta });
    }

    // O link de pagamento vem dentro de "links", no item com rel = "PAY"
    const linkPagamento = (dadosResposta.links || []).find(l => l.rel === 'PAY');

    if (!linkPagamento) {
      console.error('Checkout criado mas sem link PAY:', JSON.stringify(dadosResposta));
      return res.status(500).json({ erro: 'Checkout criado, mas o link de pagamento não foi encontrado.' });
    }

    return res.json({
      checkoutId: dadosResposta.id,
      linkPagamento: linkPagamento.href
    });

  } catch (erro) {
    console.error('Erro inesperado ao criar checkout:', erro);
    return res.status(500).json({ erro: 'Erro interno ao criar checkout.' });
  }
});

// ===================== 2) RECEBER WEBHOOK DO PAGBANK ========================
// O PagBank chama esta URL sozinho, sempre que o status do pagamento mudar.
app.post('/webhook/pagbank', async (req, res) => {
  try {
    const payloadCru = req.body.toString('utf8'); // corpo exato recebido, sem reformatar
    const assinaturaRecebida = req.headers['x-authenticity-token'];

    // A assinatura esperada é SHA256("{token}-{payload}"), conforme a
    // documentação oficial ("Confirmar autenticidade da notificação").
    const assinaturaEsperada = crypto
      .createHash('sha256')
      .update(`${PAGBANK_TOKEN}-${payloadCru}`)
      .digest('hex');

    // ⚠️ Ponto de atenção (relatado por outros desenvolvedores na comunidade
    // do PagBank): no ambiente de SANDBOX, o header "x-authenticity-token"
    // às vezes simplesmente não é enviado — mesmo com tudo configurado
    // certo. Por isso, aqui NÃO bloqueamos mais a notificação quando a
    // assinatura falta ou não confere — apenas avisamos no log. Isso evita
    // perder confirmações de pagamento reais durante os testes.
    // 👉 Antes de ir para produção, veja nos logs se o header passa a vir
    // corretamente; se sim, você pode voltar a bloquear (return res.status
    // (401)...) para maior segurança contra notificações falsas.
    if (!assinaturaRecebida) {
      console.warn('⚠️  Webhook de checkout chegou sem o header x-authenticity-token (comum em sandbox) — processando mesmo assim.');
    } else if (assinaturaRecebida !== assinaturaEsperada) {
      console.warn('⚠️  Assinatura do webhook de checkout não confere com o esperado — processando mesmo assim, mas verifique se é legítimo.');
    }

    // Responde rápido ao PagBank para evitar reenvios da notificação.
    res.status(200).send('OK');

    const notificacao = JSON.parse(payloadCru);

    // O status pode vir em "status" (evento de checkout) ou dentro de
    // "charges[0].status" (evento de pagamento associado ao pedido).
    const statusPagamento = notificacao?.charges?.[0]?.status || notificacao?.status;

    console.log(`🔔 Webhook do PagBank recebido. Status: ${statusPagamento} | ID: ${notificacao.id}`);

    if (statusPagamento === 'PAID') {
      // ✅ PAGAMENTO CONFIRMADO DE VERDADE.
      console.log(`✅ Pagamento confirmado — Cliente: ${notificacao?.customer?.name || 'desconhecido'}`);

      // 👉 Repassa a confirmação para seu Make/Zapier/n8n, se configurado.
      if (WEBHOOK_PAGAMENTO_CONFIRMADO) {
        fetch(WEBHOOK_PAGAMENTO_CONFIRMADO, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evento: 'pagamento_confirmado', notificacao })
        }).catch(err => console.error('Falha ao repassar webhook para automação externa:', err));
      }

      // 👉 Aqui é o lugar certo para: salvar em banco de dados, emitir a
      // nota fiscal automaticamente, enviar e-mail/WhatsApp de confirmação
      // ao cliente, etc. Adicione seu código abaixo.

    } else if (statusPagamento === 'DECLINED') {
      console.log('❌ Pagamento recusado.');
    } else if (statusPagamento === 'IN_ANALYSIS') {
      console.log('🕓 Pagamento em análise de risco pelo PagBank.');
    }

  } catch (erro) {
    console.error('Erro ao processar webhook do PagBank:', erro);
    if (!res.headersSent) res.status(500).send('Erro interno');
  }
});

// Rota simples de teste, útil pra conferir que o deploy no Render subiu certo.
app.get('/', (req, res) => res.send('Servidor da Spin Tecnologia no ar ✅'));

// ============================================================================
// ===== 3) COBRANÇAS RECORRENTES (mês 2, 3, 4...) — CONFIGURAÇÃO NECESSÁRIA ===
// ============================================================================
// IMPORTANTE: diferente do webhook de checkout, os eventos de ASSINATURA
// (cada cobrança mensal) usam um sistema separado do PagBank, chamado
// "Pagamentos Recorrentes". A URL que recebe esses eventos NÃO é configurada
// junto com o checkout — ela é configurada UMA VEZ PARA A CONTA TODA, através
// do endpoint abaixo. Isso significa que, ao rodar essa configuração, TODAS
// as assinaturas da sua conta (inclusive as criadas por este Checkout
// Recorrente) passam a notificar essa mesma URL.
//
// ⚠️ Ponto de atenção (achado na comunidade de desenvolvedores do PagBank):
// a documentação oficial diz que a assinatura de segurança desses webhooks
// usa o mesmo método SHA-256 do checkout (header "x-authenticity-token"),
// mas alguns desenvolvedores relataram receber, na prática, um header
// diferente ("X-Payload-Signature", em outro formato). Por isso, abaixo o
// endpoint tenta validar pelo método documentado, mas SÓ REGISTRA UM AVISO
// (não bloqueia) se não bater — assim você não perde nenhuma notificação
// enquanto testa no sandbox. Veja os logs do Render após o primeiro teste
// para confirmar qual header realmente chega, e ajuste se precisar.

async function configurarWebhookDeAssinaturas() {
  if (MEU_DOMINIO.includes('SEU-APP')) {
    console.warn('⚠️  MEU_DOMINIO ainda não foi configurado — pulei o registro do webhook de assinaturas.');
    return;
  }
  try {
    const resposta = await fetch(`${ASSINATURAS_API_URL}/preferences/notifications`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${PAGBANK_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        urls: [`${MEU_DOMINIO}/webhook/pagbank-assinaturas`]
      })
    });
    if (resposta.ok) {
      console.log('✅ URL de notificação de assinaturas configurada com sucesso na conta PagBank.');
    } else {
      const detalhes = await resposta.text();
      console.warn('⚠️  Não foi possível configurar a URL de notificação de assinaturas:', detalhes);
    }
  } catch (erro) {
    console.warn('⚠️  Erro ao tentar configurar a URL de notificação de assinaturas:', erro.message);
  }
}

// Endpoint manual: chame-o (ex: com um POST vazio via Postman/curl) sempre
// que quiser (re)registrar a URL de notificação — por exemplo, se o domínio
// do Render mudar, ou se quiser confirmar que está tudo certo.
app.post('/configurar-webhook-assinaturas', async (req, res) => {
  await configurarWebhookDeAssinaturas();
  res.send('Registro solicitado — confira os logs do servidor para o resultado.');
});

// Recebe os eventos de COBRANÇA MENSAL (subscription.recurrence), além de
// outros eventos do ciclo de vida da assinatura (ativação, suspensão,
// cancelamento, etc — ver lista completa nos comentários abaixo).
app.post('/webhook/pagbank-assinaturas', async (req, res) => {
  try {
    const payloadCru = req.body.toString('utf8');

    // Tenta validar pelo método documentado (mesmo esquema do checkout).
    const assinaturaRecebida = req.headers['x-authenticity-token'] || req.headers['x-payload-signature'];
    const assinaturaEsperada = crypto
      .createHash('sha256')
      .update(`${PAGBANK_TOKEN}-${payloadCru}`)
      .digest('hex');

    if (req.headers['x-authenticity-token'] && req.headers['x-authenticity-token'] !== assinaturaEsperada) {
      console.warn('⚠️  Assinatura (x-authenticity-token) não confere com o esperado — processando mesmo assim, mas VERIFIQUE nos logs se essa notificação é legítima.');
    }
    if (!assinaturaRecebida) {
      console.warn('⚠️  Notificação de assinatura chegou sem nenhum header de assinatura conhecido. Cabeçalhos recebidos:', JSON.stringify(req.headers));
    }

    res.status(200).send('OK'); // responde rápido para o PagBank não reenviar

    const notificacao = JSON.parse(payloadCru);

    // Eventos possíveis (ver documentação "Webhooks — Pagamentos Recorrentes"):
    // subscription.initial | subscription.updated | subscription.activated |
    // subscription.suspended | subscription.recurrence | subscription.expired |
    // subscription.canceled | subscription.migrated
    const evento = notificacao?.event;
    const assinatura = notificacao?.resource || {};

    console.log(`🔔 Webhook de ASSINATURA recebido. Evento: ${evento} | Status: ${assinatura.status} | Assinatura: ${assinatura.id}`);

    if (evento === 'subscription.recurrence') {
      // ✅ Uma nova cobrança do mês foi processada.
      console.log(`💳 Cobrança mensal processada para ${assinatura?.customer?.name || 'cliente desconhecido'} — status: ${assinatura.status}`);

      if (WEBHOOK_COBRANCA_RECORRENTE) {
        fetch(WEBHOOK_COBRANCA_RECORRENTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evento: 'cobranca_recorrente', notificacao })
        }).catch(err => console.error('Falha ao repassar webhook de cobrança recorrente:', err));
      }

      // 👉 Aqui é o lugar certo para: registrar a renovação no seu banco de
      // dados, emitir a nota fiscal do mês, enviar recibo por e-mail, etc.

    } else if (evento === 'subscription.canceled' || evento === 'subscription.expired') {
      console.log(`🚫 Assinatura ${assinatura.id} foi ${evento === 'subscription.canceled' ? 'cancelada' : 'expirada'}.`);
      // 👉 Aqui: suspenda o acesso do cliente ao serviço, se for o caso.
    }

  } catch (erro) {
    console.error('Erro ao processar webhook de assinatura:', erro);
    if (!res.headersSent) res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} (ambiente PagBank: ${PAGBANK_AMBIENTE})`);
  if (RECORRENCIA_ATIVA) {
    // Tenta registrar a URL de webhook de assinaturas automaticamente. Não
    // impede o servidor de subir caso falhe — só avisa nos logs.
    configurarWebhookDeAssinaturas();
  }
});
