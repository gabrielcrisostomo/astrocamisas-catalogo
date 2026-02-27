const { MercadoPagoConfig, Payment } = require('mercadopago');
const { google } = require('googleapis');
const nodemailer = require('nodemailer'); 

export default async function handler(req, res) {
    console.log("🔔 WEBHOOK CHAMADO!", req.query, req.body);

    res.status(200).send('OK');
}

export default async function handler(req, res) {
    res.status(200).send('OK');

    if (req.query.type === 'payment' || req.body.type === 'payment') {
        const paymentId = req.query['data.id'] || req.body.data.id;

        try {
            const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
            const payment = new Payment(client);
            
            const dadosPagamento = await payment.get({ id: paymentId });

            if (dadosPagamento.status === 'approved') {
                const tamanho = dadosPagamento.metadata.tamanho_comprado;
                const emailCliente = dadosPagamento.payer.email; 
                const nomeCliente = dadosPagamento.payer.first_name || 'Astro';

                // 1. Desconta o estoque na planilha
                await descontarEstoquePlanilha(tamanho);

                // 2. Envia o e-mail de confirmação
                if (emailCliente) {
                    await enviarEmailConfirmacao(emailCliente, nomeCliente, tamanho);
                }
            }
        } catch (error) {
            console.error("Erro ao processar Webhook:", error);
        }
    }
}

async function descontarEstoquePlanilha(tamanhoComprado) {
    const auth = new google.auth.JWT(
        process.env.GOOGLE_CLIENT_EMAIL,
        null,
        process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
        ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    
    const SPREADSHEET_ID = '1K0stGKAKR9db6F0yg-y9KE3Gv7F3eWZEMXOV6UMiafs'; 
    const NOME_DA_ABA = 'Página1'; 
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${NOME_DA_ABA}!A:B`, // A = Tamanho, B = Quantidade
        });

        const linhas = response.data.values;
        if (!linhas || linhas.length === 0) return;

        for (let i = 0; i < linhas.length; i++) {
            const linha = linhas[i];
            const tamanhoPlanilha = linha[0]; 

            if (tamanhoPlanilha === tamanhoComprado) {
                const quantidadeAtual = parseInt(linha[1]); 
                
                // Se tiver estoque, diminui 1
                if (quantidadeAtual > 0) {
                    const novaQuantidade = quantidadeAtual - 1;
                    const numeroDaLinha = i + 1; 

                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${NOME_DA_ABA}!B${numeroDaLinha}`, 
                        valueInputOption: 'RAW',
                        requestBody: {
                            values: [[novaQuantidade]]
                        }
                    });
                    console.log(`Sucesso: Estoque do tamanho ${tamanhoComprado} atualizado para ${novaQuantidade}.`);
                }
                break;
            }
        }
    } catch (erro) {
        console.error("Erro ao alterar planilha:", erro);
    }
}


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
        console.log(`E-mail de confirmação enviado para ${emailDestino}`);
    } catch (error) {
        console.error("Erro ao enviar e-mail:", error);
    }
}