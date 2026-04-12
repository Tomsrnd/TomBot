const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");

// ⚠️ NE PARTAGE PAS CE FICHIER
const TOKEN                 = "MTQ5MDgwMTI4NTAxNTAxMTQzOA.GADac1.T6IxKw0-Oz9odUb1kHoGAABgHzyaZKy5vHZbpY";
const GUILD_ID              = "1227139774884876308";
const OWNER_ID              = "195918925035339777";
const DASHBOARD_PORT        = 3000;

// ── Salons ──
const WELCOME_CHANNEL = "👋│présentations";
const RULES_CHANNEL   = "📜│règles";
const LOGS_CHANNEL    = "📋│logs";
const LIVE_CHANNEL    = "📡│live-maintenant";

// ── Twitch ──
const TWITCH_CLIENT_ID      = "ft9odgkme8zglpq1vfhdkuwa4d66ke";
const TWITCH_CLIENT_SECRET  = "poo4b1h4vslgztbiqiwl9ezk7tl1j4";
const TWITCH_USERNAME       = "Tom_O_Carre";
let   twitchAccessToken     = null;
let   isStreamLive          = false;
let   lastAnnouncedStreamId = null;

// ── Rôle après QCM ──
const ROLE_AFTER_QCM = "🌱 Nouveau";

// ════════════════════════════════════════════════
//  DONNÉES PARTAGÉES (bot ↔ dashboard)
// ════════════════════════════════════════════════
const dashData = {
  members:          0,
  deleted:          0,
  qcmValidated:     0,
  streamsAnnounced: 0,
  logs:             [],   // { user, word, channel, time }
  qcmMembers:       [],   // { name, date }
  streams:          [],   // { title, game, time }
  bannedWords: [
    "pute","pouffe","pouf","poufiase","pouffy","poufyase","pouffyase",
    "cul","encule","ntm","niquetamere","enfoire","pede","pd","salot","mbdtc","fdp",
    "filsdepute","bite","fu","fuck","fucker","facka","maddafacka","bitch","biatch",
    "motherfucker","fum","ass","asshole","fucking","fuckoff","fuq","fuqa",
    "porn","porno","pr0n","p0rn","gangbang","handjob","blowjob","cilithang",
    "onlyfans","mym","fansly","hentai","xxx","nude","nudes",
  ],
};

// ════════════════════════════════════════════════
//  CENSURE
// ════════════════════════════════════════════════
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function containsBannedWord(content) {
  const norm = normalize(content);
  for (const word of dashData.bannedWords) {
    if (norm.includes(normalize(word))) return word;
  }
  return null;
}

// ════════════════════════════════════════════════
//  RÈGLES
// ════════════════════════════════════════════════
const RULES = `
**Règle 1 — Respect**
Sois respectueux envers tous les membres. Les insultes, harcèlements ou propos discriminatoires sont strictement interdits.

**Règle 2 — Pas de spam**
Il est interdit d'envoyer des messages répétitifs, des suites de caractères ou de flood les salons.

**Règle 3 — Pas de publicité**
Aucune publicité (liens, serveurs Discord, réseaux sociaux, etc.) sans autorisation préalable d'un modérateur.

**Règle 4 — Contenu adapté**
Tout contenu choquant, adulte ou illégal est interdit. Reste dans le thème du salon dans lequel tu écris.

**Règle 5 — Langue**
Le français est la langue principale du serveur. Merci de l'utiliser dans les salons publics.

**Règle 6 — Bonne ambiance**
Ce serveur est dédié au gaming et à la communauté de Tom_O_Carre. Viens avec une bonne humeur et profite ! 🎮

_Le non-respect de ces règles entraîne un warn, un mute ou un ban selon la gravité._
`;

// ════════════════════════════════════════════════
//  QCM
// ════════════════════════════════════════════════
const QCM = [
  {
    question: "❓ Question 1 — Quelle est la règle principale du serveur ?",
    answers: [
      { label: "Respecter tout le monde", correct: true },
      { label: "Faire du spam librement", correct: false },
      { label: "Faire de la pub sans limite", correct: false },
    ],
  },
  {
    question: "❓ Question 2 — Le spam est-il autorisé sur ce serveur ?",
    answers: [
      { label: "Non, c'est interdit", correct: true },
      { label: "Oui, dans tous les salons", correct: false },
      { label: "Seulement la nuit", correct: false },
    ],
  },
  {
    question: "❓ Question 3 — Que risques-tu si tu ne respectes pas les règles ?",
    answers: [
      { label: "Un warn, mute ou ban", correct: true },
      { label: "Rien du tout", correct: false },
      { label: "Un message privé sympa", correct: false },
    ],
  },
];

const sessions = new Map();

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function buildQuestion(userId, step) {
  const q = QCM[step];
  const shuffled = shuffle(q.answers);
  sessions.get(userId).shuffled = shuffled;
  const embed = new EmbedBuilder()
    .setColor("#5865f2")
    .setTitle(`📋 QCM — Question ${step + 1} / ${QCM.length}`)
    .setDescription(q.question)
    .setFooter({ text: "Tom_O_Carre • Vérification des règles" });
  const row = new ActionRowBuilder().addComponents(
    shuffled.map((a, i) =>
      new ButtonBuilder()
        .setCustomId(`qcm_${userId}_${i}`)
        .setLabel(a.label)
        .setStyle(ButtonStyle.Primary)
    )
  );
  return { embeds: [embed], components: [row] };
}

// ════════════════════════════════════════════════
//  TWITCH API
// ════════════════════════════════════════════════
function httpsPost(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST" }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
  });
}

async function getTwitchToken() {
  const data = await httpsPost(
    `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
  );
  twitchAccessToken = data.access_token;
  console.log("🔑 Token Twitch obtenu");
}

async function checkTwitchStream() {
  try {
    if (!twitchAccessToken) await getTwitchToken();
    const data = await httpsGet(
      `https://api.twitch.tv/helix/streams?user_login=${TWITCH_USERNAME}`,
      { "Client-ID": TWITCH_CLIENT_ID, "Authorization": `Bearer ${twitchAccessToken}` }
    );
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      if (!isStreamLive || lastAnnouncedStreamId !== stream.id) {
        isStreamLive = true;
        lastAnnouncedStreamId = stream.id;
        await announceStream(stream);
      }
    } else {
      isStreamLive = false;
    }
  } catch (e) {
    twitchAccessToken = null;
    console.error("⚠️ Erreur Twitch :", e.message);
  }
}

async function announceStream(stream) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const liveChannel = guild.channels.cache.find(c => c.name === LIVE_CHANNEL);
    if (!liveChannel) return;
    const thumbnail = stream.thumbnail_url.replace("{width}", "1280").replace("{height}", "720");
    const embed = new EmbedBuilder()
      .setColor("#9146ff")
      .setTitle(`🔴 ${TWITCH_USERNAME} est en live !`)
      .setDescription(
        `**${stream.title}**\n\n` +
        `🎮 Jeu : **${stream.game_name || "Non renseigné"}**\n` +
        `👥 Spectateurs : **${stream.viewer_count}**\n\n` +
        `👉 [Rejoindre le stream](https://twitch.tv/${TWITCH_USERNAME})`
      )
      .setImage(thumbnail)
      .setURL(`https://twitch.tv/${TWITCH_USERNAME}`)
      .setFooter({ text: "Tom_O_Carre • Twitch" })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("🎮 Regarder le live")
        .setURL(`https://twitch.tv/${TWITCH_USERNAME}`)
        .setStyle(ButtonStyle.Link)
    );
    await liveChannel.send({
      content: "@everyone 🔴 **Le stream vient de commencer !**",
      embeds: [embed], components: [row],
    });

    // Enregistrer dans le dashboard
    dashData.streams.push({
      title: stream.title,
      game: stream.game_name || "Inconnu",
      time: new Date().toLocaleString("fr-FR"),
    });
    dashData.streamsAnnounced++;
    console.log("📡 Annonce live envoyée !");
  } catch (e) {
    console.error("⚠️ Erreur annonce live :", e.message);
  }
}

// ════════════════════════════════════════════════
//  SERVEUR WEB DASHBOARD
// ════════════════════════════════════════════════
function startDashboard() {
  const server = http.createServer((req, res) => {
    const url = req.url;

    // ── API : données ──
    if (url === "/api/data") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        members:          dashData.members,
        deleted:          dashData.deleted,
        qcmValidated:     dashData.qcmMembers.length,
        streamsAnnounced: dashData.streamsAnnounced,
        logs:             dashData.logs.slice(-50),
        qcmMembers:       dashData.qcmMembers.slice(-50),
        streams:          dashData.streams.slice(-20),
        bannedWords:      dashData.bannedWords,
        isLive:           isStreamLive,
      }));
    }

    // ── API : ajouter mot banni ──
    if (url === "/api/words/add" && req.method === "POST") {
      let body = "";
      req.on("data", d => body += d);
      req.on("end", () => {
        try {
          const { word } = JSON.parse(body);
          const w = word.trim().toLowerCase();
          if (w && !dashData.bannedWords.includes(w)) {
            dashData.bannedWords.push(w);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Mot déjà présent ou vide" }));
          }
        } catch(e) {
          res.writeHead(400); res.end("{}");
        }
      });
      return;
    }

    // ── API : supprimer mot banni ──
    if (url.startsWith("/api/words/remove/") && req.method === "DELETE") {
      const word = decodeURIComponent(url.replace("/api/words/remove/", ""));
      const idx = dashData.bannedWords.indexOf(word);
      if (idx > -1) dashData.bannedWords.splice(idx, 1);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    // ── Servir le dashboard HTML ──
    if (url === "/" || url === "/index.html") {
      const file = path.join(__dirname, "dashboard.html");
      if (fs.existsSync(file)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(file));
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(DASHBOARD_PORT, "0.0.0.0", () => {
    console.log(`🌐 Dashboard dispo sur http://192.168.1.162:${DASHBOARD_PORT}`);
  });
}

// ════════════════════════════════════════════════
//  CLIENT DISCORD
// ════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once("clientReady", async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);

  // Membres du serveur
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    dashData.members = members.filter(m => !m.user.bot).size;
  } catch(e) {}

  // Règles — ne reposte QUE si aucun message avec bouton QCM n'existe déjà
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const rulesChannel = guild.channels.cache.find(c => c.name === RULES_CHANNEL);
    if (rulesChannel) {
      const msgs = await rulesChannel.messages.fetch({ limit: 20 });
      const alreadyPosted = msgs.some(m =>
        m.author.id === client.user.id && m.components.length > 0
      );
      if (alreadyPosted) {
        console.log("📜 Règles déjà présentes, pas de repost");
      } else {
        const embed = new EmbedBuilder()
          .setColor("#5865f2")
          .setTitle("📜 Règles du serveur Tom_O_Carre")
          .setDescription(RULES)
          .setFooter({ text: "Lis bien les règles avant de participer !" });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("start_qcm")
            .setLabel("✅ J'ai lu les règles — Passer le QCM")
            .setStyle(ButtonStyle.Success)
        );
        await rulesChannel.send({ embeds: [embed], components: [row] });
        console.log("📜 Règles postées");
      }
    }
  } catch (e) {
    console.error("⚠️ Impossible de poster les règles :", e.message);
  }

  // Twitch
  await checkTwitchStream();
  setInterval(checkTwitchStream, 2 * 60 * 1000);
  console.log("📡 Surveillance Twitch activée");

  // Dashboard
  startDashboard();
});

// Nouveau membre
client.on("guildMemberAdd", async (member) => {
  dashData.members++;
  try {
    const guild = member.guild;
    const welcomeChannel = guild.channels.cache.find(c => c.name === WELCOME_CHANNEL);
    if (!welcomeChannel) return;
    const rulesChannel = guild.channels.cache.find(c => c.name === RULES_CHANNEL);
    const rulesLink = rulesChannel ? `<#${rulesChannel.id}>` : "le salon règles";
    const embed = new EmbedBuilder()
      .setColor("#9146ff")
      .setTitle("🎮 Bienvenue sur le serveur de Tom_O_Carre !")
      .setDescription(
        `Hey <@${member.id}>, bienvenue parmi nous ! 🎉\n\n` +
        `Tu rejoins la communauté gaming de **Tom_O_Carre** sur Twitch & YouTube.\n\n` +
        `📜 Avant tout, rends-toi dans ${rulesLink} pour **lire les règles** et passer le **QCM de vérification**.\n` +
        `Une fois validé, tu auras accès à tous les salons ! 🚀`
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Membre #${guild.memberCount}` })
      .setTimestamp();
    await welcomeChannel.send({ embeds: [embed] });
  } catch (e) {
    console.error("⚠️ Erreur bienvenue :", e.message);
  }
});

// Censure
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.author.id === OWNER_ID) return;

  const banned = containsBannedWord(message.content);
  if (banned) {
    try {
      await message.delete();
      await message.author.send(
        `⚠️ **Ton message sur le serveur Tom_O_Carre a été supprimé.**\n` +
        `Il contenait un mot interdit. Merci de respecter les règles ! 🙏`
      ).catch(() => {});

      const warn = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor("#ed4245")
            .setDescription(`🚫 <@${message.author.id}> — Message supprimé : contenu interdit.`)
        ]
      });
      setTimeout(() => warn.delete().catch(() => {}), 5000);

      // Log Discord
      const guild = message.guild;
      const logsChannel = guild.channels.cache.find(c => c.name === LOGS_CHANNEL);
      if (logsChannel) {
        await logsChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor("#ed4245")
              .setTitle("🚫 Message supprimé — Mot interdit")
              .addFields(
                { name: "Membre", value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
                { name: "Salon", value: `<#${message.channel.id}>`, inline: true },
                { name: "Mot détecté", value: `\`${banned}\``, inline: true },
                { name: "Message", value: `\`\`\`${message.content.slice(0, 300)}\`\`\`` }
              )
              .setTimestamp()
          ]
        });
      }

      // Log dashboard
      dashData.logs.push({
        user: message.author.tag,
        word: banned,
        channel: message.channel.name,
        time: new Date().toLocaleString("fr-FR"),
      });
      dashData.deleted++;

    } catch (e) {
      console.error("⚠️ Erreur censure :", e.message);
    }
  }
});

// Interactions QCM
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;
  const guild  = interaction.guild;

  if (interaction.customId === "start_qcm") {
    sessions.set(userId, { step: 0, score: 0, shuffled: [] });
    await interaction.reply({ ...buildQuestion(userId, 0), ephemeral: true });
    return;
  }

  if (interaction.customId.startsWith(`qcm_${userId}_`)) {
    const session = sessions.get(userId);
    if (!session) {
      await interaction.reply({ content: "❌ Session expirée, reclique sur le bouton des règles.", ephemeral: true });
      return;
    }
    const answerIndex = parseInt(interaction.customId.split("_").pop());
    const chosen = session.shuffled[answerIndex];

    if (chosen.correct) {
      session.score++;
      session.step++;
      if (session.step < QCM.length) {
        await interaction.update(buildQuestion(userId, session.step));
      } else {
        sessions.delete(userId);
        try {
          const member = await guild.members.fetch(userId);
          const role = guild.roles.cache.find(r => r.name === ROLE_AFTER_QCM);
          if (role) await member.roles.add(role);
          const logsChannel = guild.channels.cache.find(c => c.name === LOGS_CHANNEL);
          if (logsChannel) {
            await logsChannel.send(`✅ **${member.user.tag}** a réussi le QCM et reçu le rôle **${ROLE_AFTER_QCM}**.`);
          }
          // Log dashboard
          dashData.qcmMembers.push({
            name: member.user.tag,
            date: new Date().toLocaleString("fr-FR"),
          });
          dashData.qcmValidated++;
        } catch (e) {}

        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setColor("#57f287")
              .setTitle("✅ QCM réussi !")
              .setDescription("Bravo ! Bienvenue dans la communauté **Tom_O_Carre** ! 🎮")
          ],
          components: [],
        });
      }
    } else {
      sessions.delete(userId);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor("#ed4245")
            .setTitle("❌ Mauvaise réponse !")
            .setDescription("Relis bien les règles et réessaie en cliquant sur le bouton ✅ dans le salon règles.")
        ],
        components: [],
      });
    }
  }
});

client.login(TOKEN);
