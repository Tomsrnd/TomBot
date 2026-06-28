// ════════════════════════════════════════════════
//  TOMBOT v5.0 — QCM avec Hugging Face
//  Version légère pour Raspberry Pi 2
// ════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");
const https = require("https");
const http  = require("http");

function loadEnv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
}
loadEnv();

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
        ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require("discord.js");

// ════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════
let TOKEN      = process.env.DISCORD_TOKEN || "";
const GUILD_ID = process.env.GUILD_ID      || "";
const OWNER_ID = process.env.OWNER_ID      || "";
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || "";

const CH = {
  welcome:"👋│présentations", rules:"📜│règles", logs:"📋│logs",
  prison:"🔒│prison", tribunal:"⚖️│tribunal",
};
const ROLES = { member:"🌱 Nouveau", prison:"🔒 Prisonnier" };
const MAX_WARNS = 3;
const DATA_FILE = path.join(__dirname, "data.json");

const RULES_TEXT = `**Règle 1 — Respect** : Insultes et harcèlement interdits.
**Règle 2 — Pas de spam** : Messages répétitifs interdits.
**Règle 3 — Pas de pub** : Aucune publicité sans autorisation.
**Règle 4 — Contenu adapté** : Contenu choquant interdit.
**Règle 5 — Français** : Langue principale du serveur.
**Règle 6 — Bonne ambiance** : Serveur gaming — sois sympa !`;

// ════════════════════════════════════════════════
//  PERSISTANCE JSON
// ════════════════════════════════════════════════
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch(e) { return {}; }
}

let saveTimer = null;
function saveData() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
    catch(e) {}
    saveTimer = null;
  }, 5000);
}

const db = {
  warns: {}, members: {}, prisonLogs: [], qcmMembers: [],
  bannedWords: ["pute","pouffe","pouf","cul","encule","ntm","enfoire","pede","pd","bite","fu","fuck","bitch","ass","asshole","porn","porno","hentai","xxx"],
  ...loadData(),
};
["warns","members","prisonLogs","qcmMembers","bannedWords"].forEach(k => {
  if (!db[k]) db[k] = (k === "bannedWords") ? [] : {};
});

const qcmSessions = new Map();

// ════════════════════════════════════════════════
//  HUGGING FACE API
// ════════════════════════════════════════════════
function callHuggingFace(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ inputs: prompt });
    const options = {
      hostname: 'api-inference.huggingface.co',
      path: '/models/mistralai/Mistral-7B-Instruct-v0.1',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = Array.isArray(parsed) ? parsed[0]?.generated_text || '' : parsed?.generated_text || '';
          resolve(text.replace(prompt, '').trim());
        } catch(e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function generateQCM() {
  const prompt = `Génère 3 questions de quiz sur ces règles :
${RULES_TEXT}

Format JSON :
{"questions": [{"question": "Q1?", "options": ["A (correct)", "B", "C"]}, ...]}`;

  try {
    const response = await callHuggingFace(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Pas de JSON");
    const qcm = JSON.parse(jsonMatch[0]);
    return qcm;
  } catch(e) {
    console.error("⚠️ HF error:", e.message);
    return null;
  }
}

async function checkAnswer(question, userAnswer) {
  const prompt = `Question: "${question.question}"
Réponse de l'utilisateur: "${userAnswer}"
Les bonnes réponses: ${question.options[0]}

Est-ce CORRECT ou INCORRECT? (réponds en une seule ligne)`;

  try {
    const response = await callHuggingFace(prompt);
    return response.includes("CORRECT");
  } catch(e) {
    return false;
  }
}

// ════════════════════════════════════════════════
//  WARNS + PRISON (minimaliste)
// ════════════════════════════════════════════════
async function warn(member, reason, guild) {
  const uid = member.user.id;
  if (!db.warns[uid]) db.warns[uid] = { count: 0, history: [] };
  db.warns[uid].count++;
  db.warns[uid].history.push({ reason, time: new Date().toLocaleString("fr-FR") });
  saveData();
  const count = db.warns[uid].count;
  member.user.send(`⚠️ **Avertissement ${count}/${MAX_WARNS}**\nRaison : ${reason}`).catch(() => {});
  const log = guild.channels.cache.find(c => c.name === CH.logs);
  if (log) log.send({ embeds: [new EmbedBuilder().setColor("#faa81a").setTitle(`⚠️ Warn ${count}/${MAX_WARNS}`).setDescription(reason).setTimestamp()] });
  if (count >= MAX_WARNS) {
    db.warns[uid].count = 0;
    saveData();
    await prison(member, `${MAX_WARNS} avertissements`, guild);
  }
}

async function prison(member, reason, guild) {
  try {
    const uid = member.user.id;
    let role = guild.roles.cache.find(r => r.name === ROLES.prison);
    if (!role) role = await guild.roles.create({ name: ROLES.prison, color: 0x4a4a4a });
    await member.roles.set([role]).catch(() => {});
    member.user.send(`🔒 Tu as été envoyé en prison.\nRaison : ${reason}`).catch(() => {});
    db.prisonLogs.push({ user: member.user.tag, userId: uid, reason, time: new Date().toLocaleString("fr-FR"), verdict: "En attente" });
    saveData();
  } catch(e) {}
}

// ════════════════════════════════════════════════
//  DISCORD CLIENT
// ════════════════════════════════════════════════
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  rest: { timeout: 15000 },
});

client.once("clientReady", async () => {
  console.log(`✅ Bot : ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    members.forEach(m => {
      if (!m.user.bot && !db.members[m.user.id])
        db.members[m.user.id] = { tag: m.user.tag, joinedAt: m.joinedAt?.toISOString() };
    });
    saveData();

    // Créer salon prison
    if (!guild.channels.cache.find(c => c.name === CH.prison)) {
      await guild.channels.create({ name: CH.prison, type: ChannelType.GuildText });
    }

    // Poster règles
    const rulesCh = guild.channels.cache.find(c => c.name === CH.rules);
    if (rulesCh) {
      const msgs = await rulesCh.messages.fetch({ limit: 10 });
      if (!msgs.some(m => m.author.id === client.user.id && m.components.length > 0)) {
        await rulesCh.send({
          embeds: [new EmbedBuilder().setColor("#5865f2").setTitle("📜 Règles").setDescription(RULES_TEXT)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("start_qcm_hf").setLabel("✅ Passer le QCM").setStyle(ButtonStyle.Success)
          )],
        });
        console.log("📜 Règles postées");
      }
    }
  } catch(e) { console.error("⚠️ Init:", e.message); }

  setInterval(() => {
    if (global.gc) global.gc();
    saveData();
  }, 30*60*1000);
});

client.on("guildMemberAdd", async member => {
  if (member.user.bot) return;
  db.members[member.user.id] = { tag: member.user.tag, joinedAt: new Date().toISOString() };
  saveData();
  const ch = member.guild.channels.cache.find(c => c.name === CH.welcome);
  if (!ch) return;
  ch.send({ embeds: [new EmbedBuilder().setColor("#9146ff").setTitle("🎮 Bienvenue !").setDescription(`Hey <@${member.id}> !\n\nVa dans #📜│règles pour lire les règles et passer le QCM. 🚀`).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
});

// Censure
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const banned = db.bannedWords.find(w => msg.content.toLowerCase().includes(w.toLowerCase()));
  if (banned) {
    try {
      await msg.delete();
      const w = await msg.channel.send({ embeds: [new EmbedBuilder().setColor("#ed4245").setDescription(`🚫 <@${msg.author.id}> — Message supprimé.`)] });
      setTimeout(() => w.delete().catch(() => {}), 5000);
      const member = await msg.guild.members.fetch(msg.author.id);
      await warn(member, `Mot interdit : "${banned}"`, msg.guild);
    } catch(e) {}
  }
});

// Interactions QCM
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  const guild = interaction.guild;

  if (interaction.customId === "start_qcm_hf") {
    await interaction.deferReply({ flags: 64 });
    try {
      await interaction.editReply({ content: "⏳ Génération du QCM..." });
      const qcm = await generateQCM();
      if (!qcm || !qcm.questions || qcm.questions.length < 3) {
        await interaction.editReply({ content: "❌ Erreur. Réessaie plus tard." });
        return;
      }
      qcmSessions.set(uid, { qcm: qcm.questions, step: 0, correct: 0 });
      await interaction.user.send({
        embeds: [new EmbedBuilder().setColor("#5865f2")
          .setTitle("📋 QCM — Question 1/3")
          .setDescription(qcm.questions[0].question)
          .addFields({ name: "Instructions", value: "Réponds par A, B ou C" })
          .setFooter({ text: "Tom_O_Carre" })],
      });
      await interaction.editReply({ content: "✅ QCM lancé ! Un message privé t'a été envoyé." });
    } catch(e) {
      console.error("QCM error:", e.message);
      await interaction.editReply({ content: "❌ Erreur" });
    }
  }

  if (interaction.customId.startsWith("validate_qcm_")) {
    const targetId = interaction.customId.replace("validate_qcm_", "");
    try {
      const member = await guild.members.fetch(targetId);
      const role = guild.roles.cache.find(r => r.name === ROLES.member);
      if (role) await member.roles.add(role);
      db.qcmMembers.push({ name: member.user.tag, date: new Date().toLocaleString("fr-FR") });
      db.members[targetId] = { ...db.members[targetId], qcmPassed: true };
      saveData();
      await interaction.reply({ content: `✅ ${member.user.tag} validé !`, flags: 64 });
    } catch(e) {
      await interaction.reply({ content: "❌ Erreur", flags: 64 });
    }
  }
});

// Réponses QCM via DM
client.on("messageCreate", async msg => {
  if (msg.author.bot || msg.guild) return;
  const uid = msg.author.id;
  const session = qcmSessions.get(uid);
  if (!session) return;

  const answer = msg.content.toUpperCase().trim();
  if (!["A", "B", "C"].includes(answer)) {
    msg.reply("❌ Réponds par A, B ou C").catch(() => {});
    return;
  }

  try {
    await msg.react("⏳");
    const isCorrect = await checkAnswer(session.qcm[session.step], answer);

    if (isCorrect) {
      session.correct++;
      session.step++;
      await msg.react("✅");

      if (session.step < 3) {
        await msg.reply({
          embeds: [new EmbedBuilder().setColor("#57f287")
            .setTitle("✅ Correct !")
            .setDescription(`**Question ${session.step + 1}/3**\n${session.qcm[session.step].question}`)],
        });
      } else {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(uid).catch(() => null);
        if (member) {
          const role = guild.roles.cache.find(r => r.name === ROLES.member);
          if (role) await member.roles.add(role);
          db.qcmMembers.push({ name: member.user.tag, date: new Date().toLocaleString("fr-FR") });
          db.members[uid] = { ...db.members[uid], qcmPassed: true };
          saveData();
        }
        await msg.reply({
          embeds: [new EmbedBuilder().setColor("#57f287")
            .setTitle("✅ QCM réussi !")
            .setDescription("Bienvenue dans la communauté Tom_O_Carre ! 🎮")],
        });
        qcmSessions.delete(uid);
      }
    } else {
      await msg.react("❌");
      await msg.reply("❌ Mauvaise réponse. Réessaie !");
    }
  } catch(e) {
    console.error("QCM check error:", e.message);
    msg.reply("❌ Erreur").catch(() => {});
  }
});

// Commande !validateqcm
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!validateqcm")) return;
  const args = msg.content.split(" ");
  const userId = args[1]?.replace(/[<@!>]/g, "");
  if (!userId) {
    msg.reply("Usage: `!validateqcm <@utilisateur>`").catch(() => {});
    return;
  }
  try {
    const member = await msg.guild.members.fetch(userId);
    const role = msg.guild.roles.cache.find(r => r.name === ROLES.member);
    if (role) await member.roles.add(role);
    db.qcmMembers.push({ name: member.user.tag, date: new Date().toLocaleString("fr-FR") });
    db.members[userId] = { ...db.members[userId], qcmPassed: true };
    saveData();
    msg.reply(`✅ ${member.user.tag} validé !`).catch(() => {});
  } catch(e) {
    msg.reply("❌ Membre introuvable").catch(() => {});
  }
});

client.login(TOKEN);
