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
  ChannelType,
  PermissionsBitField,
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
const PRISON_TEXT      = "🔒│prison";
const PRISON_VOCAL     = "🔒│vocal-prison";
const TRIBUNAL_CHANNEL = "⚖️│tribunal";
const ROLE_AFTER_QCM   = "🌱 Nouveau";
const ROLE_PRISON      = "🔒 Prisonnier";
const ROLE_MODO        = "🛡️ Modérateur";
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
  prisonLogs: [],
  warns: {},
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

// ── Twitch Bot Chat ──
const twitchBot = {
  username: process.env.TWITCH_BOT_USERNAME || "",
  token:    process.env.TWITCH_BOT_TOKEN    || "",
  connected: false,
  socket:   null,
};

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
//  CRÉATION SALONS PRISON
// ════════════════════════════════════════════════
async function setupPrisonChannels(guild) {
  // Récupérer ou créer la catégorie MODÉRATION
  let prisonCat = guild.channels.cache.find(c => c.name === "🔒 PRISON" && c.type === ChannelType.GuildCategory);

  // Rôles
  let prisonRole = guild.roles.cache.find(r => r.name === ROLE_PRISON);
  if (!prisonRole) {
    prisonRole = await guild.roles.create({
      name: ROLE_PRISON,
      color: "#4a4a4a",
      reason: "Rôle prison automatique",
    });
    console.log("🔒 Rôle Prisonnier créé");
  }

  const modoRole = guild.roles.cache.find(r => r.name === ROLE_MODO);

  // Créer catégorie PRISON si inexistante
  if (!prisonCat) {
    prisonCat = await guild.channels.create({
      name: "🔒 PRISON",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        // Tout le monde ne peut pas voir
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        // Prisonniers peuvent voir
        { id: prisonRole.id, allow: [PermissionsBitField.Flags.ViewChannel] },
        // Modérateurs peuvent voir
        ...(modoRole ? [{ id: modoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageMessages] }] : []),
      ],
    });
    console.log("📁 Catégorie Prison créée");
  }

  // Salon texte prison
  if (!guild.channels.cache.find(c => c.name === PRISON_TEXT)) {
    await guild.channels.create({
      name: PRISON_TEXT,
      type: ChannelType.GuildText,
      parent: prisonCat.id,
      topic: "Salon réservé aux prisonniers et modérateurs",
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: prisonRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ...(modoRole ? [{ id: modoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] }] : []),
      ],
    });
    console.log("💬 Salon texte prison créé");
  }

  // Salon vocal prison
  if (!guild.channels.cache.find(c => c.name === PRISON_VOCAL)) {
    await guild.channels.create({
      name: PRISON_VOCAL,
      type: ChannelType.GuildVoice,
      parent: prisonCat.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] },
        { id: prisonRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
        ...(modoRole ? [{ id: modoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.MuteMembers] }] : []),
      ],
    });
    console.log("🔊 Salon vocal prison créé");
  }

  // Salon tribunal
  if (!guild.channels.cache.find(c => c.name === TRIBUNAL_CHANNEL)) {
    const modoCat = guild.channels.cache.find(c => c.name === "🛡️ MODÉRATION" && c.type === ChannelType.GuildCategory);
    await guild.channels.create({
      name: TRIBUNAL_CHANNEL,
      type: ChannelType.GuildText,
      parent: modoCat?.id || prisonCat.id,
      topic: "Tribunal — décisions pour les prisonniers",
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ...(modoRole ? [{ id: modoRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] : []),
      ],
    });
    console.log("⚖️ Salon tribunal créé");
  }
}

// ════════════════════════════════════════════════
//  SYSTÈME DE WARNS + PRISON
// ════════════════════════════════════════════════
async function warnUser(member, reason, guild) {
  const uid = member.user.id;
  if (!dashData.warns[uid]) dashData.warns[uid] = { count: 0, history: [] };
  dashData.warns[uid].count++;
  dashData.warns[uid].history.push({ reason, time: new Date().toLocaleString("fr-FR") });
  const count = dashData.warns[uid].count;

  await member.user.send(
    `⚠️ **Avertissement ${count}/${MAX_WARNS} sur le serveur Tom_O_Carre**\n` +
    `Raison : ${reason}\n` +
    (count >= MAX_WARNS
      ? "🔒 Tu as atteint le maximum — tu vas être envoyé en prison !"
      : `Il te reste ${MAX_WARNS - count} avertissement(s) avant la prison.`)
  ).catch(() => {});

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

  if (count >= MAX_WARNS) {
    await sendToPrison(member, `${count} avertissements accumulés`, guild);
    dashData.warns[uid].count = 0;
  }
}

async function sendToPrison(member, reason, guild) {
  try {
    const prisonRole = guild.roles.cache.find(r => r.name === ROLE_PRISON);
    if (!prisonRole) { await setupPrisonChannels(guild); }

    // Sauvegarder les rôles actuels
    const rolesBackup = member.roles.cache
      .filter(r => r.id !== guild.roles.everyone.id && r.name !== ROLE_PRISON)
      .map(r => r.id);

    // Donner uniquement le rôle prisonnier
    await member.roles.set([guild.roles.cache.find(r => r.name === ROLE_PRISON)]).catch(() => {});

    // Message dans le salon prison
    const prisonChannel = guild.channels.cache.find(c => c.name === PRISON_TEXT);
    if (prisonChannel) {
      await prisonChannel.send({ embeds: [
        new EmbedBuilder().setColor("#ed4245")
          .setTitle("🔒 Nouveau prisonnier !")
          .setDescription(
            `<@${member.user.id}>, tu as été envoyé en prison.\n\n` +
            `**Raison :** ${reason}\n\n` +
            `Un modérateur va décider de ton sort dans le salon ⚖️ tribunal.\n` +
            `Tu peux parler ici et dans le salon vocal 🔒 en attendant.`
          ).setThumbnail(member.user.displayAvatarURL()).setTimestamp()
      ]});
    }

    // Message dans le tribunal
    const tribunalChannel = guild.channels.cache.find(c => c.name === TRIBUNAL_CHANNEL);
    if (tribunalChannel) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verdict_free_${member.user.id}`).setLabel("🔓 Liberté").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`verdict_mute_${member.user.id}`).setLabel("🔇 Mute 24h").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`verdict_ban_${member.user.id}`).setLabel("🔨 Ban").setStyle(ButtonStyle.Danger),
      );
      await tribunalChannel.send({
        content: `@here ⚖️ **Nouveau prisonnier à juger !**`,
        embeds: [new EmbedBuilder().setColor("#faa81a")
          .setTitle(`⚖️ Tribunal — ${member.user.tag}`)
          .setDescription(`**Membre :** <@${member.user.id}>\n**Raison :** ${reason}\n\nChoisissez le verdict :`)
          .setThumbnail(member.user.displayAvatarURL()).setTimestamp()],
        components: [row],
      });
    }

    // MP au prisonnier
    await member.user.send(
      `🔒 **Tu as été envoyé en prison sur le serveur Tom_O_Carre !**\n` +
      `Raison : ${reason}\n` +
      `Un modérateur va décider de ton sort. Tu peux parler dans le salon prison en attendant.`
    ).catch(() => {});

    dashData.prisonLogs.push({
      user: member.user.tag,
      userId: member.user.id,
      reason,
      time: new Date().toLocaleString("fr-FR"),
      verdict: "En attente",
      rolesBackup,
    });

    console.log(`🔒 ${member.user.tag} envoyé en prison`);
  } catch(e) { console.error("⚠️ Erreur prison :", e.message); }
}


// ════════════════════════════════════════════════
//  TWITCH CHAT BOT (IRC)
// ════════════════════════════════════════════════
const net = require("net");

function connectTwitchChat() {
  if (!twitchBot.username || !twitchBot.token) {
    console.log("⚠️ Twitch bot non configuré (username/token manquant)");
    return;
  }

  const socket = net.createConnection(6667, "irc.chat.twitch.tv");
  twitchBot.socket = socket;

  socket.on("connect", () => {
    socket.write(`PASS oauth:${twitchBot.token}\r\n`);
    socket.write(`NICK ${twitchBot.username}\r\n`);
    socket.write(`JOIN #${config.twitchUsername.toLowerCase()}\r\n`);
    console.log(`💜 Twitch bot connecté : ${twitchBot.username} → #${config.twitchUsername}`);
    twitchBot.connected = true;
  });

  socket.on("data", (data) => {
    const msg = data.toString();

    // Répondre au PING de Twitch
    if (msg.includes("PING")) {
      socket.write("PONG :tmi.twitch.tv\r\n");
      return;
    }

    // Modération du chat si activée
    if (config.twitchChatModEnabled && msg.includes("PRIVMSG")) {
      const match = msg.match(/:(.+)!.+@.+\.tmi\.twitch\.tv PRIVMSG #\S+ :(.+)/);
      if (match) {
        const user = match[1];
        const text = match[2].trim();
        const banned = containsBannedWord(text);
        if (banned && user.toLowerCase() !== config.twitchUsername.toLowerCase()) {
          sendTwitchMessage(`/timeout ${user} 600 Mot interdit : ${banned}`);
          sendTwitchMessage(`@${user} ⚠️ Ton message a été supprimé car il contient un mot interdit.`);
          dashData.twitchChatLogs.push({
            message: `🚫 [${user}] supprimé : "${banned}"`,
            time: new Date().toLocaleString("fr-FR"),
            status: "🚫"
          });
          console.log(`🚫 Twitch : ${user} timeout — mot : "${banned}"`);
        }
      }
    }
  });

  socket.on("error", (e) => {
    twitchBot.connected = false;
    console.error("⚠️ Twitch chat error :", e.message);
  });

  socket.on("close", () => {
    twitchBot.connected = false;
    console.log("💔 Twitch chat déconnecté — reconnexion dans 30s...");
    setTimeout(connectTwitchChat, 30000);
  });
}

function sendTwitchMessage(message) {
  if (!twitchBot.socket || !twitchBot.connected) return;
  twitchBot.socket.write(`PRIVMSG #${config.twitchUsername.toLowerCase()} :${message}\r\n`);
  dashData.twitchChatLogs.push({
    message,
    time: new Date().toLocaleString("fr-FR"),
    status: "✅"
  });
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
        members:dashData.members, deleted:dashData.deleted,
        qcmValidated:dashData.qcmMembers.length, streamsAnnounced:dashData.streamsAnnounced,
        logs:dashData.logs.slice(-50), qcmMembers:dashData.qcmMembers.slice(-50),
        streams:dashData.streams.slice(-20), bannedWords:dashData.bannedWords,
        twitchChatLogs:dashData.twitchChatLogs.slice(-20),
        prisonLogs:dashData.prisonLogs.slice(-20),
        warns:dashData.warns, isLive:isStreamLive,
        config:{
          twitchUsername:config.twitchUsername, announceEnabled:config.announceEnabled,
          mentionEveryone:config.mentionEveryone, showThumbnail:config.showThumbnail,
          twitchChatModEnabled:config.twitchChatModEnabled,
        },
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
          if (data.twitchBotUsername)  { twitchBot.username=data.twitchBotUsername; envUpdates.TWITCH_BOT_USERNAME=data.twitchBotUsername; }
          if (data.twitchBotToken)     { twitchBot.token=data.twitchBotToken; envUpdates.TWITCH_BOT_TOKEN=data.twitchBotToken; if(twitchBot.socket) twitchBot.socket.destroy(); setTimeout(connectTwitchChat,1000); }
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

    if (url==="/api/code" && req.method==="GET") {
      const botFile=path.join(__dirname,"welcome-bot.js");
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify({code:fs.readFileSync(botFile,"utf8")}));
    }

    if (url==="/api/code" && req.method==="POST") {
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        try {
          const {code}=JSON.parse(body);
          const botFile=path.join(__dirname,"welcome-bot.js");
          fs.writeFileSync(botFile+".backup",fs.readFileSync(botFile));
          fs.writeFileSync(botFile,code);
          res.writeHead(200,{"Content-Type":"application/json"});
          res.end(JSON.stringify({ok:true,message:"Code sauvegardé ! Lance : pm2 restart tom-bot"}));
        } catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}
      });
      return;
    }

    if (url==="/" || url==="/index.html") {
      const file=path.join(__dirname,"dashboard.html");
      if (fs.existsSync(file)) {
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
        return res.end(fs.readFileSync(file));
      }
    }


    // ── GET /api/files — liste des fichiers ──
    if (url === "/api/files" && req.method === "GET") {
      const botDir = __dirname;
      const allowed = ["welcome-bot.js", "dashboard.html", ".env", "package.json", "welcome-bot.js.backup"];
      const files = allowed.map(name => {
        const filePath = path.join(botDir, name);
        const exists = fs.existsSync(filePath);
        return {
          name,
          exists,
          size: exists ? fs.statSync(filePath).size : 0,
          modified: exists ? fs.statSync(filePath).mtime.toLocaleString("fr-FR") : null,
        };
      });
      res.writeHead(200, {"Content-Type": "application/json"});
      return res.end(JSON.stringify({files}));
    }

    // ── GET /api/files/:name — lire un fichier ──
    if (url.startsWith("/api/files/read/") && req.method === "GET") {
      const name = decodeURIComponent(url.replace("/api/files/read/", ""));
      const allowed = ["welcome-bot.js", "dashboard.html", ".env", "package.json", "welcome-bot.js.backup"];
      if (!allowed.includes(name)) { res.writeHead(403); return res.end(JSON.stringify({ok:false,error:"Fichier non autorisé"})); }
      const filePath = path.join(__dirname, name);
      if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end(JSON.stringify({ok:false,error:"Fichier introuvable"})); }
      res.writeHead(200, {"Content-Type": "application/json"});
      return res.end(JSON.stringify({ok:true, content: fs.readFileSync(filePath, "utf8"), name}));
    }

    // ── POST /api/files/save — sauvegarder un fichier ──
    if (url === "/api/files/save" && req.method === "POST") {
      let body = ""; req.on("data", d => body += d);
      req.on("end", () => {
        try {
          const {name, content} = JSON.parse(body);
          const allowed = ["welcome-bot.js", "dashboard.html", ".env", "package.json"];
          if (!allowed.includes(name)) { res.writeHead(403); return res.end(JSON.stringify({ok:false,error:"Fichier non autorisé"})); }
          const filePath = path.join(__dirname, name);
          // Backup automatique
          if (fs.existsSync(filePath)) fs.writeFileSync(filePath + ".backup", fs.readFileSync(filePath));
          fs.writeFileSync(filePath, content);
          res.writeHead(200, {"Content-Type": "application/json"});
          res.end(JSON.stringify({ok:true, message:`${name} sauvegardé !`}));
        } catch(e) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:e.message})); }
      });
      return;
    }

    // ── GET /api/files/download/:name — télécharger un fichier ──
    if (url.startsWith("/api/files/download/") && req.method === "GET") {
      const name = decodeURIComponent(url.replace("/api/files/download/", ""));
      const allowed = ["welcome-bot.js", "dashboard.html", ".env", "package.json", "welcome-bot.js.backup"];
      if (!allowed.includes(name)) { res.writeHead(403); return res.end("Interdit"); }
      const filePath = path.join(__dirname, name);
      if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end("Introuvable"); }
      res.writeHead(200, {"Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`});
      return res.end(fs.readFileSync(filePath));
    }

    // ── POST /api/files/upload — uploader un fichier ──
    if (url === "/api/files/upload" && req.method === "POST") {
      let body = ""; req.on("data", d => body += d);
      req.on("end", () => {
        try {
          const {name, content} = JSON.parse(body);
          const allowed = ["welcome-bot.js", "dashboard.html", ".env", "package.json"];
          if (!allowed.includes(name)) { res.writeHead(403); return res.end(JSON.stringify({ok:false,error:"Fichier non autorisé"})); }
          const filePath = path.join(__dirname, name);
          if (fs.existsSync(filePath)) fs.writeFileSync(filePath + ".backup", fs.readFileSync(filePath));
          fs.writeFileSync(filePath, content);
          res.writeHead(200, {"Content-Type": "application/json"});
          res.end(JSON.stringify({ok:true, message:`${name} uploadé avec succès !`}));
        } catch(e) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:e.message})); }
      });
      return;
    }

    // ── GET /api/logs/pm2 — logs PM2 en direct ──
    if (url === "/api/logs/pm2" && req.method === "GET") {
      const logFile = path.join(process.env.HOME || "/root", ".pm2/logs/tom-bot-out.log");
      const errFile = path.join(process.env.HOME || "/root", ".pm2/logs/tom-bot-error.log");
      let logs = "";
      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, "utf8").split("\n");
        logs += lines.slice(-50).join("\n");
      }
      let errors = "";
      if (fs.existsSync(errFile)) {
        const lines = fs.readFileSync(errFile, "utf8").split("\n");
        errors += lines.slice(-20).join("\n");
      }
      res.writeHead(200, {"Content-Type": "application/json"});
      return res.end(JSON.stringify({ok:true, logs, errors}));
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
  intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
           GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
           GatewayIntentBits.GuildMessageReactions],
});

client.once("clientReady", async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    dashData.members = members.filter(m=>!m.user.bot).size;
    await setupPrisonChannels(guild);
  } catch(e) { console.error("⚠️ Init :",e.message); }

  // Règles
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const rulesChannel = guild.channels.cache.find(c=>c.name===RULES_CHANNEL);
    if (rulesChannel) {
      const msgs = await rulesChannel.messages.fetch({limit:20});
      const alreadyPosted = msgs.some(m=>m.author.id===client.user.id && m.components.length>0);
      if (!alreadyPosted) {
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

_Le non-respect de ces règles entraîne un warn, une prison ou un ban selon la gravité._`;
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
  connectTwitchChat();
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

// ── Censure — TOUT LE MONDE sauf bots ──────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const banned = containsBannedWord(message.content);
  if (banned) {
    try {
      await message.delete();
      const warn = await message.channel.send({embeds:[new EmbedBuilder().setColor("#ed4245").setDescription(`🚫 <@${message.author.id}> — Message supprimé : contenu interdit.`)]});
      setTimeout(()=>warn.delete().catch(()=>{}), 5000);

      const guild = message.guild;
      const member = await guild.members.fetch(message.author.id);
      await warnUser(member, `Mot interdit : "${banned}"`, guild);

      dashData.logs.push({user:message.author.tag, word:banned, channel:message.channel.name, time:new Date().toLocaleString("fr-FR")});
      dashData.deleted++;

      const logsChannel = guild.channels.cache.find(c=>c.name===LOGS_CHANNEL);
      if (logsChannel) {
        const warnCount = dashData.warns[message.author.id]?.count || 0;
        await logsChannel.send({embeds:[new EmbedBuilder().setColor("#ed4245")
          .setTitle("🚫 Message supprimé — Mot interdit")
          .addFields(
            {name:"Membre",value:`<@${message.author.id}> (${message.author.tag})`,inline:true},
            {name:"Salon",value:`<#${message.channel.id}>`,inline:true},
            {name:"Mot",value:`\`${banned}\``,inline:true},
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

  // QCM
  if (interaction.customId==="start_qcm") {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const QCM = [
      { question:"❓ Question 1 — Quelle est la règle principale du serveur ?",
        answers:[{label:"Respecter tout le monde",correct:true},{label:"Faire du spam librement",correct:false},{label:"Faire de la pub sans limite",correct:false}]},
      { question:"❓ Question 2 — Le spam est-il autorisé sur ce serveur ?",
        answers:[{label:"Non, c'est interdit",correct:true},{label:"Oui, dans tous les salons",correct:false},{label:"Seulement la nuit",correct:false}]},
      { question:"❓ Question 3 — Que risques-tu si tu ne respectes pas les règles ?",
        answers:[{label:"Un warn, prison ou ban",correct:true},{label:"Rien du tout",correct:false},{label:"Un message privé sympa",correct:false}]},
    ];
    const step = 0;
    const q = QCM[step];
    const shuffled = [...q.answers].sort(()=>Math.random()-0.5);
    sessions.set(userId,{step,score:0,shuffled,qcm:QCM});
    const embed = new EmbedBuilder().setColor("#5865f2").setTitle(`📋 QCM — Question 1 / ${QCM.length}`).setDescription(q.question).setFooter({text:"Tom_O_Carre • Vérification des règles"});
    const row = new ActionRowBuilder().addComponents(shuffled.map((a,i)=>new ButtonBuilder().setCustomId(`qcm_${userId}_${i}`).setLabel(a.label).setStyle(ButtonStyle.Primary)));
    await interaction.followUp({embeds:[embed],components:[row],ephemeral:true}).catch(async()=>{
      await interaction.reply({embeds:[embed],components:[row],ephemeral:true}).catch(()=>{});
    });
    return;
  }

  if (interaction.customId.startsWith(`qcm_${userId}_`)) {
    const session = sessions.get(userId);
    if (!session) {
      await interaction.reply({content:"❌ Session expirée. Clique à nouveau sur le bouton ✅ dans le salon règles.",ephemeral:true}).catch(()=>{});
      return;
    }
    // Defer pour éviter le timeout Discord
    await interaction.deferUpdate().catch(()=>{});
    const answerIndex = parseInt(interaction.customId.split("_").pop());
    const chosen = session.shuffled[answerIndex];
    if (chosen.correct) {
      session.score++; session.step++;
      if (session.step < session.qcm.length) {
        const q = session.qcm[session.step];
        const shuffled = [...q.answers].sort(()=>Math.random()-0.5);
        session.shuffled = shuffled;
        const embed = new EmbedBuilder().setColor("#5865f2").setTitle(`📋 QCM — Question ${session.step+1} / ${session.qcm.length}`).setDescription(q.question).setFooter({text:"Tom_O_Carre • Vérification des règles"});
        const row = new ActionRowBuilder().addComponents(shuffled.map((a,i)=>new ButtonBuilder().setCustomId(`qcm_${userId}_${i}`).setLabel(a.label).setStyle(ButtonStyle.Primary)));
        await interaction.editReply({embeds:[embed],components:[row]}).catch(()=>{});
      } else {
        sessions.delete(userId);
        try {
          const member = await guild.members.fetch(userId);
          const role = guild.roles.cache.find(r=>r.name===ROLE_AFTER_QCM);
          if (role) await member.roles.add(role);
          const logsChannel = guild.channels.cache.find(c=>c.name===LOGS_CHANNEL);
          if (logsChannel) await logsChannel.send(`✅ **${member.user.tag}** a réussi le QCM et reçu le rôle **${ROLE_AFTER_QCM}**.`);
          dashData.qcmMembers.push({name:member.user.tag,date:new Date().toLocaleString("fr-FR")});
          dashData.qcmValidated++;
        } catch(e) {}
        await interaction.editReply({embeds:[new EmbedBuilder().setColor("#57f287").setTitle("✅ QCM réussi !").setDescription("Bravo ! Bienvenue dans la communauté **Tom_O_Carre** ! 🎮")],components:[]}).catch(()=>{});
      }
    } else {
      sessions.delete(userId);
      await interaction.editReply({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("❌ Mauvaise réponse !").setDescription("Relis bien les règles et réessaie.")],components:[]}).catch(()=>{});
    }
    return;
  }

  // TRIBUNAL
  if (interaction.customId.startsWith("verdict_")) {
    const parts = interaction.customId.split("_");
    const verdict = parts[1];
    const targetId = parts[2];
    try {
      const target = await guild.members.fetch(targetId);
      const prisonLog = dashData.prisonLogs.find(p=>p.userId===targetId && p.verdict==="En attente");
      const judgeTag = interaction.user.tag;
      const prisonRole = guild.roles.cache.find(r=>r.name===ROLE_PRISON);
      const memberRole = guild.roles.cache.find(r=>r.name===ROLE_AFTER_QCM);

      if (verdict==="free") {
        if (prisonRole) await target.roles.remove(prisonRole).catch(()=>{});
        if (memberRole) await target.roles.add(memberRole).catch(()=>{});
        await target.user.send(`🔓 **Tu es libre !** Le tribunal a décidé de te libérer. Bienvenue de retour !`).catch(()=>{});
        if (prisonLog) prisonLog.verdict = `🔓 Liberté (par ${judgeTag})`;
        await interaction.update({embeds:[new EmbedBuilder().setColor("#57f287").setTitle("⚖️ Verdict : Liberté").setDescription(`<@${targetId}> a été libéré par <@${interaction.user.id}>.`)],components:[]});

      } else if (verdict==="mute") {
        await target.timeout(24*60*60*1000,"Décision du tribunal").catch(()=>{});
        if (prisonRole) await target.roles.remove(prisonRole).catch(()=>{});
        if (memberRole) await target.roles.add(memberRole).catch(()=>{});
        await target.user.send(`🔇 **Verdict : Mute 24h.** Tu pourras parler à nouveau dans 24 heures.`).catch(()=>{});
        if (prisonLog) prisonLog.verdict = `🔇 Mute 24h (par ${judgeTag})`;
        await interaction.update({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle("⚖️ Verdict : Mute 24h").setDescription(`<@${targetId}> a été mute 24h par <@${interaction.user.id}>.`)],components:[]});

      } else if (verdict==="ban") {
        await target.user.send(`🔨 **Verdict : Ban permanent.** Tu as été banni du serveur Tom_O_Carre.`).catch(()=>{});
        await guild.members.ban(targetId,{reason:`Décision du tribunal par ${judgeTag}`});
        if (prisonLog) prisonLog.verdict = `🔨 Ban (par ${judgeTag})`;
        await interaction.update({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("⚖️ Verdict : Ban").setDescription(`<@${targetId}> a été banni par <@${interaction.user.id}>.`)],components:[]});
      }

      const logsChannel = guild.channels.cache.find(c=>c.name===LOGS_CHANNEL);
      if (logsChannel) await logsChannel.send(`⚖️ **Verdict tribunal** — <@${targetId}> : **${verdict}** par <@${interaction.user.id}>`);

    } catch(e) { console.error("⚠️ Tribunal :",e.message); await interaction.reply({content:"❌ Erreur lors du verdict.",ephemeral:true}); }
  }
});

client.login(TOKEN);
