const { MercadoPagoConfig, Payment } = require('mercadopago');
const { google } = require('googleapis');
const nodemailer = require('nodemailer'); // <-- Nova biblioteca

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
                const emailCliente = dadosPagamento.payer.email; // Pega o email do cliente
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

// --- Função que conecta no Google Sheets ---
async function descontarEstoquePlanilha(tamanhoComprado) {
    // Autenticação usando as Variáveis de Ambiente
    const auth = new google.auth.JWT(
        process.env.GOOGLE_CLIENT_EMAIL,
        null,
        process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Arruma a quebra de linha da chave
        ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    
    // O ID da sua planilha (fica na URL original do Google Sheets entre /d/ e /edit)
    const SPREADSHEET_ID = 'COLOQUE_AQUI_O_ID_DA_SUA_PLANILHA'; 
    const NOME_DA_ABA = 'Página1'; // Mude se o nome da sua aba for diferente (ex: Estoque)

    try {
        // 1. Lê a planilha atual (Pega as Colunas A e B)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${NOME_DA_ABA}!A:B`, // A = Tamanho, B = Quantidade
        });

        const linhas = response.data.values;
        if (!linhas || linhas.length === 0) return;

        // 2. Procura em qual linha está o tamanho comprado
        for (let i = 0; i < linhas.length; i++) {
            const linha = linhas[i];
            const tamanhoPlanilha = linha[0]; // Coluna A

            if (tamanhoPlanilha === tamanhoComprado) {
                const quantidadeAtual = parseInt(linha[1]); // Coluna B
                
                // Se tiver estoque, diminui 1
                if (quantidadeAtual > 0) {
                    const novaQuantidade = quantidadeAtual - 1;
                    const numeroDaLinha = i + 1; // Array começa em 0, planilhas em 1

                    // 3. Salva a nova quantidade de volta na planilha
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_ID,
                        range: `${NOME_DA_ABA}!B${numeroDaLinha}`, // Atualiza SÓ a célula da quantidade
                        valueInputOption: 'RAW',
                        requestBody: {
                            values: [[novaQuantidade]]
                        }
                    });
                    console.log(`Sucesso: Estoque do tamanho ${tamanhoComprado} atualizado para ${novaQuantidade}.`);
                }
                break; // Para o loop após encontrar o tamanho
            }
        }
    } catch (erro) {
        console.error("Erro ao alterar planilha:", erro);
    }
}

// --- Função que envia o E-mail ---
async function enviarEmailConfirmacao(emailDestino, nome, tamanho) {
    // Configuração do servidor de e-mail (Exemplo usando Gmail)
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_LOJA, // Seu email (ex: contato@astrocamisas.com.br)
            pass: process.env.EMAIL_SENHA   // Sua senha de aplicativo do Gmail
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