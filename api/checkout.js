const { MercadoPagoConfig, Preference } = require('mercadopago');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    // A sua chave secreta configurada na Vercel
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    try {
        const { tamanho } = req.body;

        // Cria a preferência de checkout no Mercado Pago
        const result = await preference.create({
            body: {
                items: [
                    {
                        id: 'drop-01-treino-perna',
                        title: `Oversized Treino de Perna - Tamanho ${tamanho}`,
                        quantity: 1,
                        unit_price: 109.90,
                        currency_id: 'BRL',
                    }
                ],
                // Para onde o Mercado Pago deve mandar o cliente depois de pagar:
                back_urls: {
                    success: "https://astrocamisas.com.br", // Pagou com sucesso
                    failure: "https://astrocamisas.com.br", // Falhou
                    pending: "https://astrocamisas.com.br"  // Pix aguardando pagamento
                },
                auto_return: "approved",
            }
        });

        // Devolve APENAS o link da página do Mercado Pago
        return res.status(200).json({ url_pagamento: result.init_point });

    } catch (error) {
        console.error("Erro ao gerar Checkout Pro:", error);
        return res.status(500).json({ erro: 'Falha ao gerar o link' });
    }
}