const { MercadoPagoConfig, Payment } = require('mercadopago');
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

async function descontarEstoquePlanilha(tamanhoComprado) {
    const urlAppsScript = "https://script.google.com/macros/s/AKfycbzTPM_56Dixlp6RlM3uXERRhGJFD0XUGzmZyNG9cfVMEKpqyK96sNBm-_i9K-_JU7HK9A/exec"; 

    try {
        console.log(`Enviando ordem para diminuir o tamanho ${tamanhoComprado} na planilha...`);
        
        const resposta = await fetch(urlAppsScript, {
            method: 'POST',
            body: JSON.stringify({ tamanho: tamanhoComprado })
        });
        
        const resultado = await resposta.text();
        console.log("Resposta da Planilha:", resultado);

    } catch (erro) {
        console.error("❌ Erro ao avisar a planilha:", erro.message);
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