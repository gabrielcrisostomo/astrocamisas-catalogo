const { MercadoPagoConfig, Preference } = require('mercadopago');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    try {
        const { tamanho, email } = req.body;

        const result = await preference.create({
            body: {
                items: [
                    {
                        id: 'drop-01-treino-perna',
                        title: `Oversized Treino de Perna - Tamanho ${tamanho}`,
                        quantity: 1,
                        unit_price: 1.00,
                        currency_id: 'BRL',
                    }
                ],
                payer: {
                    email: email 
                },
                back_urls: {
                    success: "https://www.astrocamisas.com.br/sucesso.html",
                    failure: "https://www.astrocamisas.com.br",
                    pending: "https://www.astrocamisas.com.br/sucesso.html"
                },
                auto_return: "approved",
                external_reference: tamanho,
                metadata: {
                    tamanho_comprado: tamanho,
                    email_comprador: email
                },
                notification_url: "https://www.astrocamisas.com.br/api/webhook" 
            }
        });

        return res.status(200).json({ url_pagamento: result.init_point });

    } catch (error) {
        console.error("Erro ao gerar Checkout Pro:", error);
        return res.status(500).json({ erro: 'Falha ao gerar o link' });
    }
}