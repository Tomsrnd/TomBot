// ════════════════════════════════════════════════
//  CHARGEMENT DU FICHIER .env
// ════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const [key, ...val] = line.split("=");
    if (key && val.length) process.env[key.trim()] = val.join("=").trim();
  }
}
loadEnv();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");
const https = require("https");
const http  = require("http");

// ════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════
let TOKEN          = process.env.DISCORD_TOKEN   || "";
const GUILD_ID     = process.env.GUILD_ID        || "";
const OWNER_ID     = process.env.OWNER_ID        || "";
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "3000");

const WELCOME_CHANNEL  = "👋│présentations";
const RULES_CHANNEL    = "📜│règles";
const LOGS_CHANNEL     = "📋│logs";
const LIVE_CHANNEL     = "📡│live-maintenant";
const PRISON_CHANNEL   = "🔒│prison";
const TRIBUNAL_CHANNEL = "⚖️│tribunal";
const ROLE_AFTER_QCM   = "🌱 Nouveau";
const ROLE_PRISON      = "🔒 Prisonnier";
const MAX_WARNS        = 3;

// ════════════════════════════════════════════════
//  DONNÉES
// ════════════════════════════════════════════════
const config = {
  twitchClientId:       process.env.TWITCH_CLIENT_ID     || "",
  twitchClientSecret:   process.env.TWITCH_CLIENT_SECRET || "",
  twitchUsername:       process.env.TWITCH_USERNAME      || "",
  announceEnabled:      true,
  mentionEveryone:      true,
  showThumbnail:        true,
  twitchChatModEnabled: false,
};

const dashData = {
  members: 0, deleted: 0, qcmValidated: 0, streamsAnnounced: 0,
  logs: [], qcmMembers: [], streams: [], twitchChatLogs: [],
  prisonLogs: [],   // { user, reason, time, verdict }
  warns: {},        // { userId: { count, history[] } }
  bannedWords: [
    "pute","pouffe","pouf","poufiase","pouffy","poufyase","pouffyase",
    "cul","encule","ntm","niquetamere","enfoire","pede","pd","salot","mbdtc","fdp",
    "filsdepute","bite","fu","fuck","fucker","facka","maddafacka","bitch","biatch",
    "motherfucker","fum","ass","asshole","fucking","fuckoff","fuq","fuqa",
    "porn","porno","pr0n","p0rn","gangbang","handjob","blowjob","cilithang",
    "onlyfans","mym","fansly","hentai","xxx","nude","nudes",
  ],
};

let twitchAccessToken = null, isStreamLive = false, lastAnnouncedStreamId = null;

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function saveEnv(updates) {
  const envPath = path.join(__dirname, ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const [key, val] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    content = regex.test(content) ? content.replace(regex, `${key}=${val}`) : content + `\n${key}=${val}`;
    process.env[key] = val;
  }
  fs.writeFileSync(envPath, content.trim() + "\n");
}

function normalize(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
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

_Le non-respect de ces règles entraîne un warn, une prison ou un ban selon la gravité._
`;

// ════════════════════════════════════════════════
//  QCM
// ════════════════════════════════════════════════
const QCM = [
  { question: "❓ Question 1 — Quelle est la règle principale du serveur ?",
    answers: [{ label:"Respecter tout le monde",correct:true},{ label:"Faire du spam librement",correct:false},{ label:"Faire de la pub sans limite",correct:false}]},
  { question: "❓ Question 2 — Le spam est-il autorisé sur ce serveur ?",
    answers: [{ label:"Non, c'est interdit",correct:true},{ label:"Oui, dans tous les salons",correct:false},{ label:"Seulement la nuit",correct:false}]},
  { question: "❓ Question 3 — Que risques-tu si tu ne respectes pas les règles ?",
    answers: [{ label:"Un warn, prison ou ban",correct:true},{ label:"Rien du tout",correct:false},{ label:"Un message privé sympa",correct:false}]},
];

const sessions = new Map();
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function buildQuestion(userId, step) {
  const q = QCM[step];
  const shuffled = shuffle(q.answers);
  sessions.get(userId).shuffled = shuffled;
  const embed = new EmbedBuilder().setColor("#5865f2")
    .setTitle(`📋 QCM — Question ${step+1} / ${QCM.length}`)
    .setDescription(q.question)
    .setFooter({ text:"Tom_O_Carre • Vérification des règles" });
  const row = new ActionRowBuilder().addComponents(
    shuffled.map((a,i) => new ButtonBuilder().setCustomId(`qcm_${userId}_${i}`).setLabel(a.label).setStyle(ButtonStyle.Primary))
  );
  return { embeds:[embed], components:[row] };
}

// ════════════════════════════════════════════════
//  SYSTÈME DE WARNS + PRISON
// ════════════════════════════════════════════════
async function warnUser(member, reason, guild) {
  const uid = member.user.id;
  if (!dashData.warns[uid]) dashData.warns[uid] = { count:0, history:[] };
  dashData.warns[uid].count++;
  dashData.warns[uid].history.push({ reason, time: new Date().toLocaleString("fr-FR") });
  const count = dashData.warns[uid].count;

  // MP à l'utilisateur
  await member.user.send(
    `⚠️ **Avertissement ${count}/${MAX_WARNS} sur le serveur Tom_O_Carre**\n` +
    `Raison : ${reason}\n` +
    `${count >= MAX_WARNS ? "🔒 Tu as atteint le maximum d'avertissements — tu vas être envoyé en prison !" : `Il te reste ${MAX_WARNS - count} avertissement(s) avant la prison.`}`
  ).catch(() => {});

  // Log
  const logsChannel = guild.channels.cache.find(c => c.name === LOGS_CHANNEL);
  if (logsChannel) {
    await logsChannel.send({ embeds: [
      new EmbedBuilder().setColor("#faa81a")
        .setTitle(`⚠️ Avertissement ${count}/${MAX_WARNS} — ${member.user.tag}`)
        .addFields(
          { name:"Membre", value:`<@${uid}>`, inline:true },
          { name:"Raison", value:reason, inline:true },
          { name:"Total warns", value:`${count}/${MAX_WARNS}`, inline:true }
        ).setTimestamp()
    ]});
  }

  // Prison si MAX atteint
  if (count >= MAX_WARNS) {
    await sendToPrison(member, `${count} avertissements accumulés`, guild);
    dashData.warns[uid].count = 0; // Reset warns après prison
  }
}

async function sendToPrison(member, reason, guild) {
  try {
    // Créer le rôle prison si inexistant
    let prisonRole = guild.roles.cache.find(r => r.name === ROLE_PRISON);
    if (!prisonRole) {
      prisonRole = await guild.roles.create({
        name: ROLE_PRISON,
        color: "#4a4a4a",
        reason: "Rôle prison automatique",
      });
      // Bloquer tous les salons pour ce rôle
      for (const [, channel] of guild.channels.cache) {
        if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
          await channel.permissionOverwrites.edit(prisonRole, {
            SendMessages: false,
            AddReactions: false,
            Connect: false,
          }).catch(() => {});
        }
      }
    }

    // Retirer tous les rôles et donner prison
    const rolesBackup = member.roles.cache
      .filter(r => r.id !== guild.roles.everyone.id && r.name !== ROLE_PRISON)
      .map(r => r.id);

    await member.roles.set([prisonRole]).catch(() => {});

    // Donner accès au salon prison et tribunal uniquement
    const prisonChannel   = guild.channels.cache.find(c => c.name === PRISON_CHANNEL);
    const tribunalChannel = guild.channels.cache.find(c => c.name === TRIBUNAL_CHANNEL);

    if (prisonChannel) {
      await prisonChannel.permissionOverwrites.edit(prisonRole, { ViewChannel:true, SendMessages:true });
      await prisonChannel.send({ embeds: [
        new EmbedBuilder().setColor("#ed4245")
          .setTitle("🔒 Tu es en prison !")
          .setDescription(
            `<@${member.user.id}>, tu as été envoyé en prison suite à : **${reason}**\n\n` +
            `Un tribunal va décider de ton sort. Attends la décision des modérateurs.\n\n` +
            `**Verdicts possibles :**\n🔓 Liberté — tu retrouves tes rôles\n🔇 Mute prolongé\n🔨 Ban permanent`
          ).setTimestamp()
      ]});
    }

    if (tribunalChannel) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verdict_free_${member.user.id}`).setLabel("🔓 Liberté").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`verdict_mute_${member.user.id}`).setLabel("🔇 Mute 24h").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`verdict_ban_${member.user.id}`).setLabel("🔨 Ban").setStyle(ButtonStyle.Danger),
      );
      await tribunalChannel.send({
        content: `@here ⚖️ **Nouveau prisonnier à juger !**`,
        embeds: [
          new EmbedBuilder().setColor("#faa81a")
            .setTitle(`⚖️ Tribunal — ${member.user.tag}`)
            .setDescription(`**Membre :** <@${member.user.id}>\n**Raison :** ${reason}\n\nVotez le verdict ci-dessous :`)
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp()
        ],
        components: [row],
      });
    }

    // Log dashboard
    dashData.prisonLogs.push({
      user: member.user.tag,
      userId: member.user.id,
      reason,
      time: new Date().toLocaleString("fr-FR"),
      verdict: "En attente",
      rolesBackup,
    });

    console.log(`🔒 ${member.user.tag} envoyé en prison — ${reason}`);
  } catch(e) { console.error("⚠️ Erreur prison :", e.message); }
}

// ════════════════════════════════════════════════
//  TWITCH API
// ════════════════════════════════════════════════
function httpsPost(url) {
  return new Promise((resolve,reject) => {
    const req = https.request(url,{method:"POST"},(res)=>{let b="";res.on("data",d=>b+=d);res.on("end",()=>resolve(JSON.parse(b)));});
    req.on("error",reject);req.end();
  });
}
function httpsGet(url,headers) {
  return new Promise((resolve,reject) => {
    const req = https.get(url,{headers},(res)=>{let b="";res.on("data",d=>b+=d);res.on("end",()=>resolve(JSON.parse(b)));});
    req.on("error",reject);
  });
}
async function getTwitchToken() {
  const data = await httpsPost(`https://id.twitch.tv/oauth2/token?client_id=${config.twitchClientId}&client_secret=${config.twitchClientSecret}&grant_type=client_credentials`);
  twitchAccessToken = data.access_token;
  console.log("🔑 Token Twitch obtenu");
}
async function checkTwitchStream() {
  if (!config.twitchClientId || !config.twitchClientSecret || !config.twitchUsername) return;
  try {
    if (!twitchAccessToken) await getTwitchToken();
    const data = await httpsGet(`https://api.twitch.tv/helix/streams?user_login=${config.twitchUsername}`,{"Client-ID":config.twitchClientId,"Authorization":`Bearer ${twitchAccessToken}`});
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      if (!isStreamLive || lastAnnouncedStreamId !== stream.id) {
        isStreamLive = true; lastAnnouncedStreamId = stream.id;
        if (config.announceEnabled) await announceStream(stream);
      }
    } else { isStreamLive = false; }
  } catch(e) { twitchAccessToken = null; console.error("⚠️ Twitch :",e.message); }
}
async function announceStream(stream) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const ch = guild.channels.cache.find(c=>c.name===LIVE_CHANNEL);
    if (!ch) return;
    const thumb = stream.thumbnail_url.replace("{width}","1280").replace("{height}","720");
    const embed = new EmbedBuilder().setColor("#9146ff")
      .setTitle(`🔴 ${config.twitchUsername} est en live !`)
      .setDescription(`**${stream.title}**\n\n🎮 Jeu : **${stream.game_name||"Non renseigné"}**\n👥 Spectateurs : **${stream.viewer_count}**\n\n👉 [Rejoindre le stream](https://twitch.tv/${config.twitchUsername})`)
      .setURL(`https://twitch.tv/${config.twitchUsername}`).setFooter({text:"Tom_O_Carre • Twitch"}).setTimestamp();
    if (config.showThumbnail) embed.setImage(thumb);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("🎮 Regarder le live").setURL(`https://twitch.tv/${config.twitchUsername}`).setStyle(ButtonStyle.Link));
    await ch.send({content:config.mentionEveryone?"@everyone 🔴 **Le stream vient de commencer !**":"🔴 **Le stream vient de commencer !**",embeds:[embed],components:[row]});
    dashData.streams.push({title:stream.title,game:stream.game_name||"Inconnu",time:new Date().toLocaleString("fr-FR")});
    dashData.streamsAnnounced++;
  } catch(e) { console.error("⚠️ Annonce live :",e.message); }
}

// ════════════════════════════════════════════════
//  SERVEUR WEB DASHBOARD
// ════════════════════════════════════════════════
function startDashboard() {
  const server = http.createServer((req,res) => {
    const url = req.url;

    if (url==="/api/data") {
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify({
        members:dashData.members,deleted:dashData.deleted,
        qcmValidated:dashData.qcmMembers.length,streamsAnnounced:dashData.streamsAnnounced,
        logs:dashData.logs.slice(-50),qcmMembers:dashData.qcmMembers.slice(-50),
        streams:dashData.streams.slice(-20),bannedWords:dashData.bannedWords,
        twitchChatLogs:dashData.twitchChatLogs.slice(-20),
        prisonLogs:dashData.prisonLogs.slice(-20),
        warns:dashData.warns,
        isLive:isStreamLive,
        config:{twitchUsername:config.twitchUsername,announceEnabled:config.announceEnabled,mentionEveryone:config.mentionEveryone,showThumbnail:config.showThumbnail,twitchChatModEnabled:config.twitchChatModEnabled},
      }));
    }

    if (url==="/api/settings" && req.method==="POST") {
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        try {
          const data=JSON.parse(body);
          const envUpdates={};
          if (data.discordToken)       { TOKEN=data.discordToken; envUpdates.DISCORD_TOKEN=data.discordToken; }
          if (data.twitchClientId)     { config.twitchClientId=data.twitchClientId; envUpdates.TWITCH_CLIENT_ID=data.twitchClientId; }
          if (data.twitchClientSecret) { config.twitchClientSecret=data.twitchClientSecret; envUpdates.TWITCH_CLIENT_SECRET=data.twitchClientSecret; }
          if (data.twitchUsername)     { config.twitchUsername=data.twitchUsername; envUpdates.TWITCH_USERNAME=data.twitchUsername; twitchAccessToken=null; }
          if (typeof data.announceEnabled!=="undefined") config.announceEnabled=data.announceEnabled;
          if (typeof data.mentionEveryone!=="undefined") config.mentionEveryone=data.mentionEveryone;
          if (typeof data.showThumbnail!=="undefined") config.showThumbnail=data.showThumbnail;
          if (typeof data.twitchChatModEnabled!=="undefined") config.twitchChatModEnabled=data.twitchChatModEnabled;
          if (Object.keys(envUpdates).length) saveEnv(envUpdates);
          res.writeHead(200,{"Content-Type":"application/json"});
          res.end(JSON.stringify({ok:true}));
        } catch(e){res.writeHead(400);res.end("{}");}
      });
      return;
    }

    if (url==="/api/words/add" && req.method==="POST") {
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        try {
          const {word}=JSON.parse(body);
          const w=word.trim().toLowerCase();
          if (w && !dashData.bannedWords.includes(w)) { dashData.bannedWords.push(w); res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true})); }
          else { res.writeHead(400); res.end(JSON.stringify({ok:false,error:"Mot déjà présent ou vide"})); }
        } catch(e){res.writeHead(400);res.end("{}");}
      });
      return;
    }

    if (url.startsWith("/api/words/remove/") && req.method==="DELETE") {
      const word=decodeURIComponent(url.replace("/api/words/remove/",""));
      const idx=dashData.bannedWords.indexOf(word);
      if (idx>-1) dashData.bannedWords.splice(idx,1);
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify({ok:true}));
    }

    // ── Lire le code source ──
    if (url==="/api/code" && req.method==="GET") {
      const botFile = path.join(__dirname,"welcome-bot.js");
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify({code:fs.readFileSync(botFile,"utf8")}));
    }

    // ── Sauvegarder le code source ──
    if (url==="/api/code" && req.method==="POST") {
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        try {
          const {code}=JSON.parse(body);
          const botFile=path.join(__dirname,"welcome-bot.js");
          // Backup avant sauvegarde
          fs.writeFileSync(botFile+".backup",fs.readFileSync(botFile));
          fs.writeFileSync(botFile,code);
          res.writeHead(200,{"Content-Type":"application/json"});
          res.end(JSON.stringify({ok:true,message:"Code sauvegardé ! Redémarre le bot avec : pm2 restart tom-bot"}));
        } catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}
      });
      return;
    }

    // ── Dashboard HTML ──
    if (url==="/" || url==="/index.html") {
      const file=path.join(__dirname,"dashboard.html");
      if (fs.existsSync(file)) {
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
        return res.end(fs.readFileSync(file));
      }
    }

    res.writeHead(404);res.end("Not found");
  });

  server.listen(DASHBOARD_PORT,"0.0.0.0",()=>{
    console.log(`🌐 Dashboard : http://192.168.1.162:${DASHBOARD_PORT}`);
  });
}

// ════════════════════════════════════════════════
//  CLIENT DISCORD
// ════════════════════════════════════════════════
const client = new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,
           GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,
           GatewayIntentBits.GuildMessageReactions],
});

client.once("clientReady", async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    dashData.members = members.filter(m=>!m.user.bot).size;

    // Créer salons prison et tribunal si inexistants
    let prisonCat = guild.channels.cache.find(c=>c.name==="🛡️ MODÉRATION" && c.type===ChannelType.GuildCategory);
    if (!guild.channels.cache.find(c=>c.name===PRISON_CHANNEL)) {
      await guild.channels.create({name:PRISON_CHANNEL,type:ChannelType.GuildText,parent:prisonCat?.id,topic:"Salon pour les membres en prison"});
      console.log("🔒 Salon prison créé");
    }
    if (!guild.channels.cache.find(c=>c.name===TRIBUNAL_CHANNEL)) {
      await guild.channels.create({name:TRIBUNAL_CHANNEL,type:ChannelType.GuildText,parent:prisonCat?.id,topic:"Tribunal pour juger les prisonniers"});
      console.log("⚖️ Salon tribunal créé");
    }
  } catch(e) { console.error("⚠️ Init :",e.message); }

  // Règles
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const rulesChannel = guild.channels.cache.find(c=>c.name===RULES_CHANNEL);
    if (rulesChannel) {
      const msgs = await rulesChannel.messages.fetch({limit:20});
      const alreadyPosted = msgs.some(m=>m.author.id===client.user.id && m.components.length>0);
      if (!alreadyPosted) {
        const embed = new EmbedBuilder().setColor("#5865f2").setTitle("📜 Règles du serveur Tom_O_Carre").setDescription(RULES).setFooter({text:"Lis bien les règles avant de participer !"});
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("start_qcm").setLabel("✅ J'ai lu les règles — Passer le QCM").setStyle(ButtonStyle.Success));
        await rulesChannel.send({embeds:[embed],components:[row]});
        console.log("📜 Règles postées");
      } else { console.log("📜 Règles déjà présentes"); }
    }
  } catch(e) { console.error("⚠️ Règles :",e.message); }

  await checkTwitchStream();
  setInterval(checkTwitchStream, 2*60*1000);
  console.log("📡 Surveillance Twitch activée");
  startDashboard();
});

// ── Nouveau membre ─────────────────────────────
client.on("guildMemberAdd", async (member) => {
  dashData.members++;
  try {
    const guild = member.guild;
    const welcomeChannel = guild.channels.cache.find(c=>c.name===WELCOME_CHANNEL);
    if (!welcomeChannel) return;
    const rulesChannel = guild.channels.cache.find(c=>c.name===RULES_CHANNEL);
    const rulesLink = rulesChannel ? `<#${rulesChannel.id}>` : "le salon règles";
    const embed = new EmbedBuilder().setColor("#9146ff")
      .setTitle("🎮 Bienvenue sur le serveur de Tom_O_Carre !")
      .setDescription(`Hey <@${member.id}>, bienvenue parmi nous ! 🎉\n\nTu rejoins la communauté gaming de **Tom_O_Carre** sur Twitch & YouTube.\n\n📜 Avant tout, rends-toi dans ${rulesLink} pour **lire les règles** et passer le **QCM de vérification**.\nUne fois validé, tu auras accès à tous les salons ! 🚀`)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({text:`Membre #${guild.memberCount}`}).setTimestamp();
    await welcomeChannel.send({embeds:[embed]});
  } catch(e) { console.error("⚠️ Bienvenue :",e.message); }
});

// ── Censure — TOUT LE MONDE sans exception ─────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return; // Seulement les bots sont exempts

  const banned = containsBannedWord(message.content);
  if (banned) {
    try {
      await message.delete();

      // Avertissement visible 5s
      const warn = await message.channel.send({embeds:[new EmbedBuilder().setColor("#ed4245").setDescription(`🚫 <@${message.author.id}> — Message supprimé : contenu interdit. (**Avertissement**)`)]});
      setTimeout(()=>warn.delete().catch(()=>{}),5000);

      // Système de warns
      const guild = message.guild;
      const member = await guild.members.fetch(message.author.id);
      await warnUser(member, `Mot interdit : "${banned}"`, guild);

      // Log dashboard
      dashData.logs.push({user:message.author.tag,word:banned,channel:message.channel.name,time:new Date().toLocaleString("fr-FR")});
      dashData.deleted++;

      // Log Discord
      const logsChannel = guild.channels.cache.find(c=>c.name===LOGS_CHANNEL);
      if (logsChannel) {
        const warnCount = dashData.warns[message.author.id]?.count || 0;
        await logsChannel.send({embeds:[new EmbedBuilder().setColor("#ed4245")
          .setTitle("🚫 Message supprimé — Mot interdit")
          .addFields(
            {name:"Membre",value:`<@${message.author.id}> (${message.author.tag})`,inline:true},
            {name:"Salon",value:`<#${message.channel.id}>`,inline:true},
            {name:"Mot détecté",value:`\`${banned}\``,inline:true},
            {name:"Avertissements",value:`${warnCount}/${MAX_WARNS}`,inline:true},
            {name:"Message",value:`\`\`\`${message.content.slice(0,300)}\`\`\``}
          ).setTimestamp()]});
      }
    } catch(e) { console.error("⚠️ Censure :",e.message); }
  }
});

// ── Interactions (QCM + Tribunal) ──────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;
  const guild  = interaction.guild;

  // ── QCM ──
  if (interaction.customId==="start_qcm") {
    sessions.set(userId,{step:0,score:0,shuffled:[]});
    await interaction.reply({...buildQuestion(userId,0),ephemeral:true});
    return;
  }

  if (interaction.customId.startsWith(`qcm_${userId}_`)) {
    const session=sessions.get(userId);
    if (!session) { await interaction.reply({content:"❌ Session expirée.",ephemeral:true}); return; }
    const answerIndex=parseInt(interaction.customId.split("_").pop());
    const chosen=session.shuffled[answerIndex];
    if (chosen.correct) {
      session.score++;session.step++;
      if (session.step<QCM.length) { await interaction.update(buildQuestion(userId,session.step)); }
      else {
        sessions.delete(userId);
        try {
          const member=await guild.members.fetch(userId);
          const role=guild.roles.cache.find(r=>r.name===ROLE_AFTER_QCM);
          if (role) await member.roles.add(role);
          const logsChannel=guild.channels.cache.find(c=>c.name===LOGS_CHANNEL);
          if (logsChannel) await logsChannel.send(`✅ **${member.user.tag}** a réussi le QCM et reçu le rôle **${ROLE_AFTER_QCM}**.`);
          dashData.qcmMembers.push({name:member.user.tag,date:new Date().toLocaleString("fr-FR")});
          dashData.qcmValidated++;
        } catch(e) {}
        await interaction.update({embeds:[new EmbedBuilder().setColor("#57f287").setTitle("✅ QCM réussi !").setDescription("Bravo ! Bienvenue dans la communauté **Tom_O_Carre** ! 🎮")],components:[]});
      }
    } else {
      sessions.delete(userId);
      await interaction.update({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("❌ Mauvaise réponse !").setDescription("Relis bien les règles et réessaie.")],components:[]});
    }
    return;
  }

  // ── TRIBUNAL ──
  if (interaction.customId.startsWith("verdict_")) {
    const parts = interaction.customId.split("_");
    const verdict = parts[1];
    const targetId = parts[2];

    try {
      const target = await guild.members.fetch(targetId);
      const prisonLog = dashData.prisonLogs.find(p=>p.userId===targetId && p.verdict==="En attente");
      const judgeTag = interaction.user.tag;

      if (verdict==="free") {
        // Rendre la liberté + redonner les rôles
        const prisonRole = guild.roles.cache.find(r=>r.name===ROLE_PRISON);
        if (prisonRole) await target.roles.remove(prisonRole).catch(()=>{});
        const memberRole = guild.roles.cache.find(r=>r.name===ROLE_AFTER_QCM);
        if (memberRole) await target.roles.add(memberRole).catch(()=>{});
        await target.user.send(`🔓 **Tu es libre !** Le tribunal a décidé de te libérer. Bienvenue de retour sur le serveur Tom_O_Carre !`).catch(()=>{});
        if (prisonLog) prisonLog.verdict = `🔓 Liberté (par ${judgeTag})`;
        await interaction.update({embeds:[new EmbedBuilder().setColor("#57f287").setTitle(`⚖️ Verdict : Liberté`).setDescription(`<@${targetId}> a été libéré par <@${interaction.user.id}>.`)],components:[]});

      } else if (verdict==="mute") {
        // Mute 24h
        await target.timeout(24*60*60*1000,"Décision du tribunal").catch(()=>{});
        const prisonRole = guild.roles.cache.find(r=>r.name===ROLE_PRISON);
        if (prisonRole) await target.roles.remove(prisonRole).catch(()=>{});
        const memberRole = guild.roles.cache.find(r=>r.name===ROLE_AFTER_QCM);
        if (memberRole) await target.roles.add(memberRole).catch(()=>{});
        await target.user.send(`🔇 **Décision du tribunal : Mute 24h.** Tu pourras parler à nouveau dans 24 heures.`).catch(()=>{});
        if (prisonLog) prisonLog.verdict = `🔇 Mute 24h (par ${judgeTag})`;
        await interaction.update({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle(`⚖️ Verdict : Mute 24h`).setDescription(`<@${targetId}> a été mute 24h par <@${interaction.user.id}>.`)],components:[]});

      } else if (verdict==="ban") {
        await target.user.send(`🔨 **Décision du tribunal : Ban permanent.** Tu as été banni du serveur Tom_O_Carre.`).catch(()=>{});
        await guild.members.ban(targetId,{reason:`Décision du tribunal par ${judgeTag}`});
        if (prisonLog) prisonLog.verdict = `🔨 Ban (par ${judgeTag})`;
        await interaction.update({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle(`⚖️ Verdict : Ban`).setDescription(`<@${targetId}> a été banni par <@${interaction.user.id}>.`)],components:[]});
      }

      // Log
      const logsChannel = guild.channels.cache.find(c=>c.name===LOGS_CHANNEL);
      if (logsChannel) await logsChannel.send(`⚖️ **Verdict tribunal** — <@${targetId}> : **${verdict}** par <@${interaction.user.id}>`);

    } catch(e) { console.error("⚠️ Tribunal :",e.message); await interaction.reply({content:"❌ Erreur lors du verdict.",ephemeral:true}); }
    return;
  }
});

client.login(TOKEN);
