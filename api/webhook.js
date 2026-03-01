const { MercadoPagoConfig, Payment } = require('mercadopago');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const pagamentosProcessados = new Set();

export default async function handler(req, res) {
    console.log("🔔 WEBHOOK ACIONADO!", "Query:", req.query, "Body:", req.body);

    let paymentId = req.query['data.id'] || req.query.id || (req.body && req.body.data && req.body.data.id);
    let action = req.query.topic || req.query.type || (req.body && req.body.action) || (req.body && req.body.type);

    if (paymentId && pagamentosProcessados.has(paymentId)) {
        console.log("⚠️ Pagamento repetido do MP ignorado para não duplicar e-mail:", paymentId);
        return res.status(200).send('OK'); 
    }

    if ((action === 'payment' || action === 'payment.created' || action === 'payment.updated') && paymentId) {
        console.log("💳 Processando Pagamento ID:", paymentId);
        
        try {
            const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
            const payment = new Payment(client);
            
            const dadosPagamento = await payment.get({ id: paymentId });
            console.log("✅ Status do Pagamento:", dadosPagamento.status);

            if (dadosPagamento.status === 'approved') {
                
                pagamentosProcessados.add(paymentId);

                const tamanho = dadosPagamento.metadata?.tamanho_comprado;
                const emailCliente = dadosPagamento.metadata?.email_comprador || dadosPagamento.payer?.email;
                const nomeCliente = dadosPagamento.payer?.first_name || 'Astro';

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
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY 
    );

    const nomeDoProduto = 'Treino de Perna';

    try {
        console.log(`Buscando estoque no Supabase: Produto ${nomeDoProduto}, Tamanho ${tamanhoComprado}...`);

        const { data, error: erroBusca } = await supabase
            .from('estoque')
            .select('quantidade')
            .eq('produto', nomeDoProduto)
            .eq('tamanho', tamanhoComprado)
            .single();

        if (erroBusca || !data) {
            console.error("❌ Erro ao buscar item no Supabase:", erroBusca?.message || "Item não encontrado");
            return;
        }

        const quantidadeAtual = data.quantidade;
        console.log(`Estoque atual no banco: ${quantidadeAtual}`);

        if (quantidadeAtual > 0) {
            const novaQuantidade = quantidadeAtual - 1;

            const { error: erroAtualizacao } = await supabase
                .from('estoque')
                .update({ quantidade: novaQuantidade })
                .eq('produto', nomeDoProduto)
                .eq('tamanho', tamanhoComprado);

            if (erroAtualizacao) {
                console.error("❌ Erro ao atualizar o Supabase:", erroAtualizacao.message);
            } else {
                console.log(`🎉 Sucesso! Supabase atualizado. Novo estoque de ${tamanhoComprado}: ${novaQuantidade}`);
            }
        } else {
            console.log(`⚠️ Atenção: Tentativa de baixar estoque já zerado do tamanho ${tamanhoComprado}.`);
        }

    } catch (erro) {
        console.error("❌ Erro grave na função do Supabase:", erro.message);
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
            <p>Em breve enviaremos mais informações sobre a entrega da sua peça.</p>
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