const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
}
// --- 👑 1. CONFIGURACIÓN DE ADMINISTRADORES ---
const ADMINS = [
    "51900000000@s.whatsapp.net", // Administrador 1
    "51911111111@s.whatsapp.net"  // Administrador 2
];

// --- 💾 PERSISTENCIA DE DATOS (DATABASE JSON) ---
const DB_FILE = './database.json';

function loadDatabase() {
    if (fs.existsSync(DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch (e) {
            console.error("Error al leer la base de datos, reiniciando...", e);
        }
    }
    return {
        nombreMoneda: "coins",
        users: {},      // { jid: { coins, banco, nivel, exp, items: [], baneadoEco: false, clan, victorias } }
        mascotas: {},   // { idMascota: { ownerJid, nombre, rareza, poder, nivel, exp, enVenta, precioVenta } }
        clanes: {},     // { nombreClan: { ownerJid, integrantes: [], banco: 0 } }
        subastas: {},   // { idSubasta: { mascotaId, vendedorJid, precioActual, mejorPostor } }
        cooldowns: {}   // { jid_comando: timestamp }
    };
}

function saveDatabase(dbData) {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

let db = loadDatabase();

function esAdmin(jid) {
    return ADMINS.includes(jid);
}

function verificarCooldown(jid, comando, segundos) {
    const ahora = Date.now();
    const clave = `${jid}_${comando}`;
    const ultimoUso = db.cooldowns[clave] || 0;
    if (ahora - ultimoUso < segundos * 1000) {
        return Math.ceil((segundos * 1000 - (ahora - ultimoUso)) / 1000);
    }
    db.cooldowns[clave] = ahora;
    saveDatabase(db);
    return 0;
}

function asegurarUsuario(jid) {
    if (!db.users[jid]) {
        db.users[jid] = {
            coins: 500,
            banco: 0,
            nivel: 1,
            exp: 0,
            items: [],
            baneadoEco: false,
            clan: null,
            victorias: 0
        };
        saveDatabase(db);
    }
}

function obtenerAleatorioAlto() {
    return Math.floor(Math.random() * (50000 - 15000 + 1)) + 15000;
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
       auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
const { connection, lastDisconnect, qr } = update;
    if (qr) {
        qrcode.generate(qr, { small: true });
    }
    // ... el resto de tu código de conexión
});
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ ¡Bot de WhatsApp conectado en Square Cloud 24/7!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        if (!text.startsWith('.')) return;

        const args = text.slice(1).split(' ');
        const comando = args.shift().toLowerCase();
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;

        asegurarUsuario(sender);
        const moneda = db.nombreMoneda || "coins";

        if (db.users[sender].baneadoEco && !esAdmin(sender) && !['ayuda', 'comandos', 'tienda'].includes(comando)) {
            await sock.sendMessage(from, { text: "❌ Estás sancionado y bloqueado del sistema de economía." });
            return;
        }

        const mencion = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;

        // ==========================================
        // 🛒 TIENDA E INVENTARIO DE ÍTEMS
        // ==========================================
        const preciosItems = {
            pico: 5000,
            totem: 10000,
            caña: 3000,
            espada: 8000
        };

        if (comando === 'tienda') {
            await sock.sendMessage(from, { text: `🛒 *Tienda Oficial de Ítems*:\n\n- \`.comprar pico\` — 5,000 ${moneda} (Necesario para .minar)\n- \`.comprar totem\` — 10,000 ${moneda} (Necesario para .ritual)\n- \`.comprar caña\` — 3,000 ${moneda} (Necesario para .pescar)\n- \`.comprar espada\` — 8,000 ${moneda} (Mejora combates)` });
        }

        if (comando === 'comprar') {
            const item = args[0]?.toLowerCase();
            if (!preciosItems[item]) return await sock.sendMessage(from, { text: "⚠️ Ese ítem no existe en la tienda. Usa \`.tienda\` para ver los disponibles." });

            const costo = preciosItems[item];
            if (db.users[sender].items.includes(item)) return await sock.sendMessage(from, { text: `⚠️ Ya posees un(a) *${item}* en tu inventario.` });
            if (db.users[sender].coins < costo) return await sock.sendMessage(from, { text: `⚠️ No tienes suficientes ${moneda}. Necesitas ${costo.toLocaleString()} ${moneda}.` });

            db.users[sender].coins -= costo;
            db.users[sender].items.push(item);
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🎉 ¡Compra exitosa! Has adquirido un(a) *${item}* por ${costo.toLocaleString()} ${moneda}.` });
        }

        if (comando === 'inventario') {
            const u = db.users[sender];
            const lista = u.items.length > 0 ? u.items.join(', ') : "Vacío";
            await sock.sendMessage(from, { text: `🎒 *Tu Inventario:*\n- Ítems: ${lista}` });
        }

        // ==========================================
        // 👑 1. ADMINISTRADORES
        // ==========================================
        if (['dar', 'quitar', 'reset', 'setmoneda', 'ban-eco', 'desban-eco', 'dar-item'].includes(comando)) {
            if (!esAdmin(sender)) {
                return await sock.sendMessage(from, { text: "⚠️ Solo los administradores autorizados pueden usar este comando." });
            }

            if (comando === 'setmoneda') {
                const nuevoNombre = args[0];
                if (!nuevoNombre) return await sock.sendMessage(from, { text: "⚠️ Especifica el nuevo nombre de la moneda." });
                db.nombreMoneda = nuevoNombre;
                saveDatabase(db);
                return await sock.sendMessage(from, { text: `✅ El nombre de la moneda cambió a: *${nuevoNombre}*` });
            }

            if (!mencion) return await sock.sendMessage(from, { text: "⚠️ Debes mencionar a un usuario (@usuario)." });
            asegurarUsuario(mencion);

            if (comando === 'dar') {
                const cant = parseInt(args[0]);
                if (isNaN(cant) || cant <= 0) return await sock.sendMessage(from, { text: "⚠️ Cantidad inválida." });
                db.users[mencion].coins += cant;
                saveDatabase(db);
                await sock.sendMessage(from, { text: `✅ Se añadieron ${cant.toLocaleString()} ${moneda} a @${mencion.split('@')[0]}`, mentions: [mencion] });
            } else if (comando === 'quitar') {
                const cant = parseInt(args[0]);
                if (isNaN(cant) || cant <= 0) return await sock.sendMessage(from, { text: "⚠️ Cantidad inválida." });
                db.users[mencion].coins = Math.max(0, db.users[mencion].coins - cant);
                saveDatabase(db);
                await sock.sendMessage(from, { text: `✅ Se restaron ${cant.toLocaleString()} ${moneda} a @${mencion.split('@')[0]}`, mentions: [mencion] });
            } else if (comando === 'reset') {
                db.users[mencion] = { coins: 500, banco: 0, nivel: 1, exp: 0, items: [], baneadoEco: false, clan: null, victorias: 0 };
                saveDatabase(db);
                await sock.sendMessage(from, { text: `🔄 Estadísticas de @${mencion.split('@')[0]} reiniciadas.`, mentions: [mencion] });
            } else if (comando === 'ban-eco') {
                db.users[mencion].baneadoEco = true;
                saveDatabase(db);
                await sock.sendMessage(from, { text: `⛔ @${mencion.split('@')[0]} ha sido bloqueado de la economía.`, mentions: [mencion] });
            } else if (comando === 'desban-eco') {
                db.users[mencion].baneadoEco = false;
                saveDatabase(db);
                await sock.sendMessage(from, { text: `✅ @${mencion.split('@')[0]} fue rehabilitado en la economía.`, mentions: [mencion] });
            } else if (comando === 'dar-item') {
                const item = args.slice(1).join(' ');
                if (!item) return await sock.sendMessage(from, { text: "⚠️ Especifica el objeto a entregar." });
                db.users[mencion].items.push(item);
                saveDatabase(db);
                await sock.sendMessage(from, { text: `🎁 Se entregó *${item}* a @${mencion.split('@')[0]}`, mentions: [mencion] });
            }
            return;
        }

        // ==========================================
        // 🐾 2. MASCOTAS DE PELÍCULAS
        // ==========================================
        if (comando === 'generar-mascota') {
            const cd = verificarCooldown(sender, 'generar-mascota', 3600);
            if (cd > 0) return await sock.sendMessage(from, { text: `⏳ Espera ${Math.ceil(cd/60)} minutos para invocar otra mascota.` });
            if (db.users[sender].coins < 100) return await sock.sendMessage(from, { text: `⚠️ Necesitas al menos 100 ${moneda}.` });
            
            db.users[sender].coins -= 100;
            const catalogo = [
                { nombre: "Baby Groot", rareza: "Rara", poder: 45 },
                { nombre: "Toothless (Chimuelo)", rareza: "Épica", poder: 85 },
                { nombre: "Calcifer", rareza: "Legendaria", poder: 120 },
                { nombre: "Minion", rareza: "Común", poder: 25 },
                { nombre: "Stitch", rareza: "Épica", poder: 90 },
                { nombre: "Yoda", rareza: "Legendaria", poder: 130 }
            ];
            const sel = catalogo[Math.floor(Math.random() * catalogo.length)];
            const idM = 'pet_' + Math.random().toString(36).substring(2, 7);

            db.mascotas[idM] = { ownerJid: sender, nombre: sel.nombre, rareza: sel.rareza, poder: sel.poder, nivel: 1, exp: 0 };
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🐾 ¡Invocación exitosa!\nID: \`${idM}\`\nCriatura: *${sel.nombre}*\nRareza: ${sel.rareza} | Poder: ${sel.poder}` });
        }

        if (comando === 'mis-mascotas') {
            const propias = Object.entries(db.mascotas).filter(([id, m]) => m.ownerJid === sender);
            if (propias.length === 0) return await sock.sendMessage(from, { text: "🎒 No tienes mascotas. Usa \`.generar-mascota\`." });
            let txt = "🎒 *Tu Colección de Mascotas:*\n";
            propias.forEach(([id, m]) => {
                txt += `\n🆔 \`${id}\` | *${m.nombre}*\n   Rareza: ${m.rareza} | Nivel: ${m.nivel} | Poder: ${m.poder}\n`;
            });
            await sock.sendMessage(from, { text: txt });
        }

        if (comando === 'vender-mascota') {
            const idM = args[0];
            const precio = parseInt(args[1]);
            if (!idM || isNaN(precio) || precio <= 0) return await sock.sendMessage(from, { text: "⚠️ Uso: \`.vender-mascota [ID] [precio]\`" });
            const pet = db.mascotas[idM];
            if (!pet || pet.ownerJid !== sender) return await sock.sendMessage(from, { text: "⚠️ Esa mascota no existe o no es tuya." });

            pet.enVenta = true;
            pet.precioVenta = precio;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🏷️ Mascota *${pet.nombre}* (\`${idM}\`) puesta en venta por ${precio.toLocaleString()} ${moneda}.` });
        }

        if (comando === 'comprar-mascota') {
            const idM = args[0];
            const pet = db.mascotas[idM];
            if (!pet || !pet.enVenta) return await sock.sendMessage(from, { text: "⚠️ Esta mascota no está a la venta." });
            if (pet.ownerJid === sender) return await sock.sendMessage(from, { text: "⚠️ No puedes comprar tu propia mascota." });
            if (db.users[sender].coins < pet.precioVenta) return await sock.sendMessage(from, { text: "⚠️ Saldo insuficiente." });

            db.users[sender].coins -= pet.precioVenta;
            db.users[pet.ownerJid].coins += pet.precioVenta;
            pet.ownerJid = sender;
            pet.enVenta = false;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🎉 ¡Compraste la mascota *${pet.nombre}* con éxito!` });
        }

        if (comando === 'subasta') {
            const idM = args[0];
            const precioBase = parseInt(args[1]);
            if (!idM || isNaN(precioBase) || precioBase <= 0) return await sock.sendMessage(from, { text: "⚠️ Uso: \`.subasta [ID-mascota] [precio-base]\`" });
            const pet = db.mascotas[idM];
            if (!pet || pet.ownerJid !== sender) return await sock.sendMessage(from, { text: "⚠️ Mascota no válida." });

            const idSub = 'sub_' + Math.random().toString(36).substring(2, 7);
            db.subastas[idSub] = { mascotaId: idM, vendedorJid: sender, precioActual: precioBase, mejorPostor: null };
            saveDatabase(db);

            await sock.sendMessage(from, { text: `📢 Subasta iniciada (\`${idSub}\`) por *${pet.nombre}*. Precio Base: ${precioBase.toLocaleString()} ${moneda}.\nUsa \`.pujar ${idSub} [cantidad]\` (Duración: 5 min).` });

            setTimeout(() => {
                if (db.subastas[idSub]) {
                    const sub = db.subastas[idSub];
                    const m = db.mascotas[sub.mascotaId];
                    if (sub.mejorPostor && m) {
                        db.users[sub.vendedorJid].coins += sub.precioActual;
                        m.ownerJid = sub.mejorPostor;
                        sock.sendMessage(from, { text: `⏰ Subasta \`${idSub}\` finalizada. @${sub.mejorPostor.split('@')[0]} ganó a *${m.nombre}* por ${sub.precioActual.toLocaleString()} ${moneda}.`, mentions: [sub.mejorPostor] });
                    } else {
                        sock.sendMessage(from, { text: `⏰ La subasta \`${idSub}\` finalizó sin pujas.` });
                    }
                    delete db.subastas[idSub];
                    saveDatabase(db);
                }
            }, 300000);
        }

        if (comando === 'pujar') {
            const idSub = args[0];
            const cant = parseInt(args[1]);
            const sub = db.subastas[idSub];
            if (!sub || isNaN(cant)) return await sock.sendMessage(from, { text: "⚠️ Datos inválidos." });
            if (sub.vendedorJid === sender) return await sock.sendMessage(from, { text: "⚠️ No puedes pujar en tu subasta." });
            if (cant <= sub.precioActual) return await sock.sendMessage(from, { text: `⚠️ Tu puja debe superar ${sub.precioActual.toLocaleString()} ${moneda}.` });
            if (db.users[sender].coins < cant) return await sock.sendMessage(from, { text: "⚠️ Fondos insuficientes." });

            sub.precioActual = cant;
            sub.mejorPostor = sender;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🔨 ¡Puja registrada en \`${idSub}\` por ${cant.toLocaleString()} ${moneda}!` });
        }

        if (comando === 'explorar') {
            const cd = verificarCooldown(sender, 'explorar', 600);
            if (cd > 0) return await sock.sendMessage(from, { text: `⏳ Mascota cansada. Espera ${Math.ceil(cd/60)} minutos.` });
            const propias = Object.values(db.mascotas).filter(m => m.ownerJid === sender);
            if (propias.length === 0) return await sock.sendMessage(from, { text: "⚠️ Necesitas una mascota." });

            const pet = propias[0];
            const premio = obtenerAleatorioAlto();
            db.users[sender].coins += premio;
            pet.exp += 30;
            if (pet.exp >= 100) { pet.nivel += 1; pet.exp = 0; pet.poder += 15; }
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🗺️ Tu mascota *${pet.nombre}* exploró un escenario épico y obtuvo **${premio.toLocaleString()} ${moneda}** y EXP.` });
        }

        if (comando === 'duelo-mascotas') {
            if (!mencion) return await sock.sendMessage(from, { text: "⚠️ Menciona al rival." });
            if (mencion === sender) return await sock.sendMessage(from, { text: "⚠️ No te enfrentes a ti mismo." });
            const m1 = Object.values(db.mascotas).filter(m => m.ownerJid === sender);
            const m2 = Object.values(db.mascotas).filter(m => m.ownerJid === mencion);
            if (!m1.length || !m2.length) return await sock.sendMessage(from, { text: "⚠️ Ambos deben poseer mascotas." });

            const g = m1[0].poder >= m2[0].poder ? sender : mencion;
            const premioDuelo = obtenerAleatorioAlto();
            db.users[g].coins += premioDuelo;
            db.users[g].victorias = (db.users[g].victorias || 0) + 1;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `⚔️ Duelo de mascotas: ¡Ganó @${g.split('@')[0]} y se lleva **${premioDuelo.toLocaleString()} ${moneda}**!`, mentions: [g] });
        }

        if (comando === 'donar') {
            if (!mencion) return await sock.sendMessage(from, { text: "⚠️ Menciona al destinatario." });
            const idM = args[1];
            const pet = db.mascotas[idM];
            if (!pet || pet.ownerJid !== sender) return await sock.sendMessage(from, { text: "⚠️ Mascota no válida." });

            pet.ownerJid = mencion;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🎁 Regalaste a *${pet.nombre}* a @${mencion.split('@')[0]}`, mentions: [mencion] });
        }

        // ==========================================
        // 💎 3. ECONOMÍA PRINCIPAL (15k A 50k)
        // ==========================================
        if (comando === 'diario') {
            const cd = verificarCooldown(sender, 'diario', 86400);
            if (cd > 0) return await sock.sendMessage(from, { text: `⏳ Espera ${Math.ceil(cd/3600)} horas para reclamar tu diario.` });
            const bono = obtenerAleatorioAlto();
            db.users[sender].coins += bono;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🎁 Bono diario reclamado: **${bono.toLocaleString()} ${moneda}** 🪙.` });
        }

        if (comando === 'semanal') {
            const cd = verificarCooldown(sender, 'semanal', 604800);
            if (cd > 0) return await sock.sendMessage(from, { text: "⏳ Aún no ha pasado 1 semana desde tu último cobro." });
            const bonoSemanal = obtenerAleatorioAlto() + 25000;
            db.users[sender].coins += bonoSemanal;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🌟 Bono semanal reclamado: **${bonoSemanal.toLocaleString()} ${moneda}** 💰.` });
        }

        if (comando === 'mensual') {
            const cd = verificarCooldown(sender, 'mensual', 2592000);
            if (cd > 0) return await sock.sendMessage(from, { text: "⏳ Recompensa disponible cada 30 días." });
            const bonoMensual = 100000;
            db.users[sender].coins += bonoMensual;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `👑 Recompensa mensual: **${bonoMensual.toLocaleString()} ${moneda}** 💎.` });
        }

        if (comando === 'trabajar') {
            const cd = verificarCooldown(sender, 'trabajar', 300);
            if (cd > 0) return await sock.sendMessage(from, { text: `⏳ Estás cansado. Vuelve en ${Math.ceil(cd/60)} min.` });
            
            const g = obtenerAleatorioAlto();
            db.users[sender].coins += g;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `💼 Trabajaste en la cantina estelar y ganaste **${g.toLocaleString()} ${moneda}**.` });
        }

        if (comando === 'crimen') {
            const cd = verificarCooldown(sender, 'crimen', 600);
            if (cd > 0) return await sock.sendMessage(from, { text: `⏳ La zona está vigilada. Espera ${Math.ceil(cd/60)} min.` });
            if (Math.random() > 0.5) {
                const b = obtenerAleatorioAlto();
                db.users[sender].coins += b;
                saveDatabase(db);
                await sock.sendMessage(from, { text: `🦹 ¡Golpe exitoso! Robaste el banco y conseguiste **${b.toLocaleString()} ${moneda}**.` });
            } else {
                const m = 15000;
                db.users[sender].coins = Math.max(0, db.users[sender].coins - m);
                saveDatabase(db);
                await sock.sendMessage(from, { text: `🚨 ¡Te atraparon! Pagaste una fianza de **${m.toLocaleString()} ${moneda}**.` });
            }
        }

        if (comando === 'banco') {
            const u = db.users[sender];
            await sock.sendMessage(from, { text: `🏦 *Tu Banco:*\n- En mano: ${u.coins.toLocaleString()} ${moneda}\n- Ahorros protegidos: ${u.banco.toLocaleString()} ${moneda}` });
        }

        if (comando === 'depositar') {
            const cant = parseInt(args[0]);
            if (isNaN(cant) || cant <= 0 || db.users[sender].coins < cant) return await sock.sendMessage(from, { text: "⚠️ Cantidad o saldo insuficiente." });
            db.users[sender].coins -= cant;
            db.users[sender].banco += cant;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `✅ Depositaste ${cant.toLocaleString()} ${moneda} en el banco.` });
        }

        if (comando === 'retirar') {
            const cant = parseInt(args[0]);
            if (isNaN(cant) || cant <= 0 || db.users[sender].banco < cant) return await sock.sendMessage(from, { text: "⚠️ Cantidad inválida o saldo insuficiente en el banco." });
            db.users[sender].banco -= cant;
            db.users[sender].coins += cant;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `✅ Retiraste ${cant.toLocaleString()} ${moneda} de tu banco.` });
        }

        if (comando === 'transferir') {
            if (!mencion) return await sock.sendMessage(from, { text: "⚠️ Menciona al destinatario." });
            const cant = parseInt(args[1]);
            if (isNaN(cant) || cant <= 0 || mencion === sender || db.users[sender].coins < cant) return await sock.sendMessage(from, { text: "⚠️ Transferencia inválida." });

            asegurarUsuario(mencion);
            db.users[sender].coins -= cant;
            db.users[mencion].coins += cant;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `💸 Transferiste ${cant.toLocaleString()} ${moneda} a @${mencion.split('@')[0]}`, mentions: [mencion] });
        }

        // ==========================================
        // 👻 4. MINIJUEGOS Y ACTIVIDADES (CON REQUISITO DE ÍTEMS)
        // ==========================================
        if (['minar', 'ritual', 'pescar', 'cazar', 'cavar', 'cofre', 'reciclar', 'mision'].includes(comando)) {
            // Validar requisitos de ítems
            if (comando === 'minar' && !db.users[sender].items.includes('pico')) {
                return await sock.sendMessage(from, { text: "⛏️ ¡Necesitas un **pico** para minar! Cómpralo usando \`.comprar pico\` (Precio: 5,000 coins)." });
            }
            if (comando === 'ritual' && !db.users[sender].items.includes('totem')) {
                return await sock.sendMessage(from, { text: "🔮 ¡Necesitas un **tótem** para hacer el ritual! Cómpralo usando \`.comprar totem\` (Precio: 10,000 coins)." });
            }
            if (comando === 'pescar' && !db.users[sender].items.includes('caña')) {
                return await sock.sendMessage(from, { text: "🎣 ¡Necesitas una **caña** para pescar! Cómprala usando \`.comprar caña\` (Precio: 3,000 coins)." });
            }

            const cd = verificarCooldown(sender, comando, 300);
            if (cd > 0) return await sock.sendMessage(from, { text: `⏳ Debes esperar ${Math.ceil(cd/60)} minutos.` });

            const r = obtenerAleatorioAlto();
            db.users[sender].coins += r;
            saveDatabase(db);

            const respuestas = {
                minar: `⛏️ Usaste tu pico y extrajiste minerales raros valorados en **${r.toLocaleString()} ${moneda}**.`,
                ritual: `🔮 Activaste tu tótem arcano y canalizaste una energía de **${r.toLocaleString()} ${moneda}**.`,
                pescar: `🎣 Lanzaste tu caña y atrapaste un pez estelar valorado en **${r.toLocaleString()} ${moneda}**.`,
                cazar: `👻 Atrapaste un ente fantástico y cobraste **${r.toLocaleString()} ${moneda}**.`,
                cavar: `🏺 Encontraste un tesoro enterrado con **${r.toLocaleString()} ${moneda}**.`,
                cofre: `🎁 ¡Abriste el cofre místico y obtuviste **${r.toLocaleString()} ${moneda}**!`,
                reciclar: `♻️ Reciclaste componentes raros y te pagaron **${r.toLocaleString()} ${moneda}**.`,
                mision: `📜 Completaste la misión del tablón y cobraste **${r.toLocaleString()} ${moneda}**.`
            };
            await sock.sendMessage(from, { text: respuestas[comando] });
        }

        // ==========================================
        // 🫂 5 & 6. GESTOS SOCIALES Y COMBATE
        // ==========================================
        const gestos = {
            abrazo: ["le dio un abrazo cálido al estilo Totoro.", "le dio un apretón de oso gigante."],
            besar: ["le dio un tierno beso con efectos de anime.", "le dio un beso en la mejilla."],
            acariciar: ["le acarició el cabello suavemente.", "le dio palmaditas de cariño."],
            café: ["le sirvió una taza de café humeante.", "lo invitó a tomar un capuchino."],
            saludar: ["le envió un saludo alegre agitando la mano.", "hizo una reverencia elegante."],
            aplaudir: ["le dio un aplauso de pie memorable.", "ovacionó con entusiasmo."],
            bailar: ["se puso a bailar breakdance a su lado.", "bailaron en sintonía."],
            guiñar: ["le guiñó un ojo de forma cómplice."],
            matar: ["escribió su nombre en la Death Note y cayó desplomado.", "chasqueó los dedos al estilo Thanos."],
            revivir: ["uso una poción de vida para resucitarlo.", "aplicó RCP mágico."],
            golpe: ["le dio un puñetazo caricaturesco viendo pajaritos.", "asestó un golpe cómico."],
            cachetada: ["le dio una bofetada dramática de telenovela.", "le cruzó la cara de un manotazo."],
            patear: ["lanzó una patada voladora cómica."],
            empujar: ["le dio un empujón amistoso de broma."],
            morder: ["le dio un mordisco gracioso en el brazo."],
            asustar: ["le dio un susto tremendo saliendo de las sombras."],
            lanzar: ["lo mandó a volar por los aires al estilo Team Rocket."],
            noquear: ["le dio un golpe dejando estrellas en su cabeza."],
            burlar: ["se rio a carcajadas señalándolo."],
            escupir: ["escupió dramáticamente en el suelo desafiándolo."],
            senalar: ["apuntó acusadoramente con el dedo."],
            ignorar: ["miró hacia otro lado fingiendo no escucharlo."],
            ocultar: ["lo tapó con una capa invisible."],
            fotografiar: ["le tomó una foto graciosa con flash."],
            despertar: ["le sacudió los hombros gritando: ¡Despierta!"]
        };

        if (gestos[comando]) {
            if (!mencion) return await sock.sendMessage(from, { text: `⚠️ Uso: \`.${comando} @usuario\`` });
            const frases = gestos[comando];
            const esc = Array.isArray(frases) ? frases[Math.floor(Math.random() * frases.length)] : frases;
            await sock.sendMessage(from, { text: `✨ @${sender.split('@')[0]} ${esc} @${mencion.split('@')[0]}`, mentions: [sender, mencion] });
        }

        // ==========================================
        // 🏰 7. CLANES
        // ==========================================
        if (comando === 'crear-clan') {
            const nom = args.join(' ');
            if (!nom) return await sock.sendMessage(from, { text: "⚠️ Especifica el nombre." });
            if (db.users[sender].clan) return await sock.sendMessage(from, { text: "⚠️ Ya perteneces a un clan." });
            if (db.clanes[nom]) return await sock.sendMessage(from, { text: "⚠️ Nombre ocupado." });

            db.clanes[nom] = { ownerJid: sender, integrantes: [sender], banco: 0 };
            db.users[sender].clan = nom;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🏰 Clan *${nom}* fundado exitosamente.` });
        }

        if (comando === 'unirse-clan') {
            const nom = args.join(' ');
            const c = db.clanes[nom];
            if (!c) return await sock.sendMessage(from, { text: "⚠️ El clan no existe." });
            if (db.users[sender].clan) return await sock.sendMessage(from, { text: "⚠️ Ya estás en un clan." });

            c.integrantes.push(sender);
            db.users[sender].clan = nom;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `🤝 Te uniste al clan *${nom}*.` });
        }

        if (comando === 'banco-clan') {
            const cName = db.users[sender].clan;
            if (!cName) return await sock.sendMessage(from, { text: "⚠️ No perteneces a un clan." });
            const c = db.clanes[cName];
            const cant = parseInt(args[0]);

            if (isNaN(cant)) return await sock.sendMessage(from, { text: `🏰 Banco del Clan *${cName}*: ${c.banco.toLocaleString()} ${moneda}` });
            if (db.users[sender].coins < cant || cant <= 0) return await sock.sendMessage(from, { text: "⚠️ Cantidad inválida." });

            db.users[sender].coins -= cant;
            c.banco += cant;
            saveDatabase(db);
            await sock.sendMessage(from, { text: `✅ Depositaste ${cant.toLocaleString()} ${moneda} al clan.` });
        }

        // ==========================================
        // 📊 8. PERFILES Y CLASIFICACIONES
        // ==========================================
        if (comando === 'perfil') {
            const obj = mencion || sender;
            asegurarUsuario(obj);
            const u = db.users[obj];
            const pets = Object.values(db.mascotas).filter(m => m.ownerJid === obj).length;

            const txt = `👤 *Perfil de Usuario*\n\n` +
                `- Cartera: ${u.coins.toLocaleString()} ${moneda}\n` +
                `- Banco: ${u.banco.toLocaleString()} ${moneda}\n` +
                `- Nivel: ${u.nivel} (Exp: ${u.exp})\n` +
                `- Ítems: ${u.items.length > 0 ? u.items.join(', ') : 'Ninguno'}\n` +
                `- Mascotas: ${pets}\n` +
                `- Clan: ${u.clan || 'Ninguno'}\n` +
                `- Duelos ganados: ${u.victorias || 0}`;

            await sock.sendMessage(from, { text: txt, mentions: [obj] });
        }

        if (comando === 'top-ricos') {
            const top = Object.entries(db.users)
                .sort((a, b) => (b[1].coins + b[1].banco) - (a[1].coins + a[1].banco))
                .slice(0, 10);

            let txt = `🏆 *Top 10 Más Ricos (${moneda})*\n\n`;
            top.forEach(([jid, data], index) => {
                txt += `${index + 1}. @${jid.split('@')[0]} — ${(data.coins + data.banco).toLocaleString()} ${moneda}\n`;
            });
            await sock.sendMessage(from, { text: txt, mentions: top.map(([j]) => j) });
        }

        if (comando === 'top-nivel') {
            const top = Object.entries(db.users)
                .sort((a, b) => b[1].nivel - a[1].nivel)
                .slice(0, 10);

            let txt = "⭐ *Top 10 Mayor Nivel*\n\n";
            top.forEach(([jid, data], index) => {
                txt += `${index + 1}. @${jid.split('@')[0]} — Nivel ${data.nivel}\n`;
            });
            await sock.sendMessage(from, { text: txt, mentions: top.map(([j]) => j) });
        }

        if (comando === 'ayuda' || comando === 'comandos') {
            const menu = `📜 *MENÚ DE COMANDOS COMPLETO*\n\n` +
                `🛒 *Tienda e Ítems:* .tienda, .comprar [item], .inventario\n` +
                `💎 *Economía (15k-50k):* .diario, .semanal, .mensual, .trabajar, .crimen, .banco, .depositar, .retirar, .transferir\n` +
                `🐾 *Mascotas:* .generar-mascota, .mis-mascotas, .vender-mascota, .comprar-mascota, .subasta, .pujar, .explorar, .duelo-mascotas, .donar\n` +
                `👻 *Minijuegos:* .minar (Requiere pico), .ritual (Requiere tótem), .pescar (Requiere caña), .cazar, .cavar, .cofre, .reciclar, .mision\n` +
                `🏰 *Clanes:* .crear-clan, .unirse-clan, .banco-clan\n` +
                `🫂 *Gestos:* .abrazo, .besar, .acariciar, .café, .matar, .golpe, .cachetada, etc.\n` +
                `📊 *Perfiles:* .perfil, .top-ricos, .top-nivel`;
            await sock.sendMessage(from, { text: menu });
        }
    });
}

connectToWhatsApp();