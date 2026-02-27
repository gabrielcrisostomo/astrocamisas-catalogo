const { MercadoPagoConfig, Payment } = require('mercadopago');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

export default async function handler(req, res) {
    // 1. LOG IMEDIATO: Isso TEM que aparecer na Vercel quando o MP bater aqui
    console.log("🔔 WEBHOOK ACIONADO!", "Query:", req.query, "Body:", req.body);

    // 2. Resposta rápida para o MP parar de tentar enviar o aviso repetidas vezes
    

    // 3. Capturando o ID do pagamento de todas as formas possíveis que o MP usa
    let paymentId = req.query['data.id'] || req.query.id || (req.body && req.body.data && req.body.data.id);
    let action = req.query.topic || req.query.type || (req.body && req.body.action) || (req.body && req.body.type);

    if ((action === 'payment' || action === 'payment.created' || action === 'payment.updated') && paymentId) {
        console.log("💳 Processando Pagamento ID:", paymentId);
        
        try {
            const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
            const payment = new Payment(client);
            
            const dadosPagamento = await payment.get({ id: paymentId });
            console.log("✅ Status do Pagamento:", dadosPagamento.status);

            if (dadosPagamento.status === 'approved') {
                const tamanho = dadosPagamento.metadata.tamanho_comprado;
                const emailCliente = dadosPagamento.payer.email;
                const nomeCliente = dadosPagamento.payer.first_name || 'Astro';

                console.log(`👕 Comprador: ${emailCliente} | Tamanho: ${tamanho}`);

                if (tamanho) {
                    await descontarEstoquePlanilha(tamanho);
                } else {
                    console.error("❌ Erro: O tamanho não veio no metadata do pagamento!");
                }

                if (emailCliente) {
                    await enviarEmailConfirmacao(emailCliente, nomeCliente, tamanho);
                }
            }
        } catch (error) {
            console.error("❌ Erro grave ao processar o Pagamento no Webhook:", error);
        }
    } else {
        console.log("⚠️ Notificação ignorada (Não é um evento de pagamento válido ou falta ID).");
    }
    res.status(200).send('OK');
}

// --- Função que conecta no Google Sheets ---
async function descontarEstoquePlanilha(tamanhoComprado) {
    const auth = new google.auth.JWT(
        process.env.GOOGLE_CLIENT_EMAIL,
        null,
        process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    
    // ATENÇÃO: Verifique se este ID está preenchido no seu código!
    const SPREADSHEET_ID = '1K0stGKAKR9db6F0yg-y9KE3Gv7F3eWZEMXOV6UMiafs'; 
    const NOME_DA_ABA = 'Página1'; // Mude para 'Página 1' se tiver espaço no nome da aba

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${NOME_DA_ABA}!A:B`, 
        });

        const linhas = response.data.values;
        if (!linhas || linhas.length === 0) {
            console.error("❌ Planilha vazia ou não encontrada.");
            return;
        }

        for (let i = 0; i < linhas.length; i++) {
            const linha = linhas[i];
            const tamanhoPlanilha = linha[0]; // Coluna A (TAMANHO)

            if (tamanhoPlanilha === tamanhoComprado) {
                const quantidadeAtual = parseInt(linha[1]); // Coluna B (QUANTIDADE)
                console.log(`Encontrou tamanho ${tamanhoPlanilha}. Estoque atual: ${quantidadeAtual}`);
                
                if (quantidadeAtual > 0) {
                    const novaQuantidade = quantidadeAtual - 1;
                    const numeroDaLinha = i + 1; 

                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${NOME_DA_ABA}!B${numeroDaLinha}`,
                        valueInputOption: 'RAW',
                        requestBody: { values: [[novaQuantidade]] }
                    });
                    console.log(`🎉 Sucesso! Estoque do tamanho ${tamanhoComprado} atualizado para ${novaQuantidade}.`);
                } else {
                    console.log(`⚠️ O estoque de ${tamanhoComprado} já está zerado!`);
                }
                break; 
            }
        }
    } catch (erro) {
        console.error("❌ Erro ao alterar planilha:", erro.message);
    }
}

// --- Função que envia o E-mail ---
async function enviarEmailConfirmacao(emailDestino, nome, tamanho) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_LOJA, 
            pass: process.env.EMAIL_SENHA   
        }
    });

    const mensagem = {
        from: `"Astro Camisas" <${process.env.EMAIL_LOJA}>`,
        to: emailDestino,
        subject: "✅ Pagamento Aprovado - Astro Camisas",
        html: `
            <h2>Fala ${nome}, tudo certo?</h2>
            <p>Seu pagamento foi aprovado com sucesso!</p>
            <p>Sua <strong>Oversized Treino de Perna (Tamanho ${tamanho})</strong> já está separada.</p>
            <p>Em breve enviaremos o código de rastreio para você acompanhar a entrega.</p>
            <br>
            <p>Tamo junto,<br>Equipe Astro Camisas</p>
        `
    };

    try {
        await transporter.sendMail(mensagem);
        console.log(`📧 E-mail de confirmação enviado para ${emailDestino}`);
    } catch (error) {
        console.error("❌ Erro ao enviar e-mail:", error.message);
    }
}