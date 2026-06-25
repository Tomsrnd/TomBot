// ════════════════════════════════════════════════
//  TOMBOT v3.0 — Toutes fonctionnalités
//  Optimisé Raspberry Pi 2
// ════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");

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
const https = require("https");
const http  = require("http");
const net   = require("net");

// ════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════
let TOKEN      = process.env.DISCORD_TOKEN || "";
const GUILD_ID = process.env.GUILD_ID      || "";
const OWNER_ID = process.env.OWNER_ID      || "";
const PORT     = parseInt(process.env.DASHBOARD_PORT || "3000");
const DASH_PWD = process.env.DASHBOARD_PASSWORD || "tombot2024";

const CH = {
  welcome:"👋│présentations", rules:"📜│règles", logs:"📋│logs",
  live:"📡│live-maintenant", prison:"🔒│prison", prisonVoc:"🔒│vocal-prison",
  tribunal:"⚖️│tribunal", planning:"📅│planning-stream",
};
const ROLES = { member:"🌱 Nouveau", prison:"🔒 Prisonnier", modo:"🛡️ Modérateur" };
const MAX_WARNS = 3;
const DATA_FILE = path.join(__dirname, "data.json");

// ── XP Config ──
const XP_PER_MSG    = 10;
const XP_COOLDOWN   = 60000; // 1 min entre chaque gain XP
const XP_LEVELS = [
  { level:1,  xp:0,    role:"🌱 Nouveau" },
  { level:2,  xp:100,  role:"🎮 Gamer" },
  { level:3,  xp:300,  role:"⭐ Régulier" },
  { level:4,  xp:600,  role:"🏆 Vétéran" },
  { level:5,  xp:1000, role:"👑 Élite" },
];

// ── Auto-réponses ──
const AUTO_RESPONSES = {
  "!discord": "🎮 Rejoins notre Discord : https://discord.gg/",
  "!youtube": "📺 Chaîne YouTube : https://youtube.com/@Tom_O_Carre",
  "!twitch":  "🟣 Twitch : https://twitch.tv/Tom_O_Carre",
  "!social":  "📱 Tous les liens : https://linktr.ee/Tom_O_Carre",
  "!rules":   "📜 Lis les règles dans le salon #règles !",
};

// ════════════════════════════════════════════════
//  PERSISTANCE JSON (throttlée pour la carte SD)
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
    catch(e) { console.error("⚠️ Save:", e.message); }
    saveTimer = null;
  }, 5000);
}

const db = {
  warns: {}, members: {}, prisonLogs: [], qcmMembers: [],
  streams: [], logs: [], twitchChatLogs: [], giveaways: [],
  polls: [], xp: {}, xpCooldowns: {}, streamStats: [],
  bannedWords: [
    "pute","pouffe","pouf","poufiase","pouffy","poufyase","pouffyase",
    "cul","encule","ntm","niquetamere","enfoire","pede","pd","salot","mbdtc","fdp",
    "filsdepute","bite","fu","fuck","fucker","facka","maddafacka","bitch","biatch",
    "motherfucker","fum","ass","asshole","fucking","fuckoff","fuq","fuqa",
    "porn","porno","pr0n","p0rn","gangbang","handjob","blowjob","cilithang",
    "onlyfans","mym","fansly","hentai","xxx","nude","nudes",
  ],
  ...loadData(),
};
["warns","members","prisonLogs","qcmMembers","streams","logs","twitchChatLogs",
 "giveaways","polls","xp","xpCooldowns","streamStats","bannedWords"].forEach(k => {
  if (!db[k]) db[k] = (k === "bannedWords") ? [] : (["xp","xpCooldowns","warns","members"].includes(k) ? {} : []);
});

// ════════════════════════════════════════════════
//  CONFIG RUNTIME
// ════════════════════════════════════════════════
const cfg = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID||"", clientSecret: process.env.TWITCH_CLIENT_SECRET||"",
    username: process.env.TWITCH_USERNAME||"", botUsername: process.env.TWITCH_BOT_USERNAME||"",
    botToken: process.env.TWITCH_BOT_TOKEN||"",
  },
  announce:true, everyone:true, thumbnail:true, twitchMod:false,
  twitchChatCommands: true,
  twitchChatReminder: { enabled:false, interval:15, message:"🎮 Rejoins notre Discord !" },
};

let twitchToken=null, isLive=false, lastStreamId=null;
let streamEndTimer=null, twitchIRCEnabled=false, streamEndTime=null;
let streamStartTime=null, streamPeakViewers=0, streamCurrentViewers=0;
const twitchBot = { socket:null, connected:false };
let deleted=0, streamsCount=0;
let reminderInterval=null;

// Sessions dashboard (auth)
const dashSessions = new Set();

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function saveEnv(u) {
  const p=path.join(__dirname,".env");
  let c=fs.existsSync(p)?fs.readFileSync(p,"utf8"):"";
  for(const[k,v]of Object.entries(u)){const r=new RegExp(`^${k}=.*$`,"m");c=r.test(c)?c.replace(r,`${k}=${v}`):c+`\n${k}=${v}`;process.env[k]=v;}
  fs.writeFileSync(p,c.trim()+"\n");
}
function normalize(s){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");}
function isBanned(t){const n=normalize(t);return db.bannedWords.find(w=>n.includes(normalize(w)))||null;}
function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min;}

// ── Notification DM au owner ──
async function notifyOwner(message) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    await owner.send(message);
  } catch(e) {}
}

// ════════════════════════════════════════════════
//  SYSTÈME XP
// ════════════════════════════════════════════════
function getLevel(xp) {
  let current = XP_LEVELS[0];
  for(const l of XP_LEVELS) { if(xp >= l.xp) current = l; }
  return current;
}
function getNextLevel(xp) {
  return XP_LEVELS.find(l => l.xp > xp) || null;
}

async function addXP(member, guild) {
  const uid = member.user.id;
  const now = Date.now();
  if(db.xpCooldowns[uid] && now - db.xpCooldowns[uid] < XP_COOLDOWN) return;
  db.xpCooldowns[uid] = now;
  if(!db.xp[uid]) db.xp[uid] = 0;
  const oldLevel = getLevel(db.xp[uid]);
  db.xp[uid] += XP_PER_MSG;
  const newLevel = getLevel(db.xp[uid]);
  saveData();

  // Level up !
  if(newLevel.level > oldLevel.level) {
    const role = guild.roles.cache.find(r => r.name === newLevel.role);
    if(role) {
      // Retirer ancien rôle de niveau
      const oldRole = guild.roles.cache.find(r => r.name === oldLevel.role);
      if(oldRole) await member.roles.remove(oldRole).catch(()=>{});
      await member.roles.add(role).catch(()=>{});
    }
    const logCh = guild.channels.cache.find(c=>c.name===CH.logs);
    if(logCh) logCh.send({ embeds:[new EmbedBuilder().setColor("#faa81a")
      .setTitle(`⭐ Level Up ! — ${member.user.tag}`)
      .setDescription(`<@${uid}> est passé niveau **${newLevel.level}** ! Rôle : **${newLevel.role}**`)
      .setTimestamp()] });
    member.user.send(`🎉 **Level Up !** Tu es maintenant niveau **${newLevel.level}** sur le serveur Tom_O_Carre !\nRôle obtenu : **${newLevel.role}** 🏆`).catch(()=>{});
  }
}

// ════════════════════════════════════════════════
//  GIVEAWAYS
// ════════════════════════════════════════════════
async function startGiveaway(guild, channelName, prize, durationMs, conditions="") {
  const ch = guild.channels.cache.find(c=>c.name===channelName) || guild.channels.cache.find(c=>c.name===CH.welcome);
  if(!ch) return null;
  const endTime = Date.now() + durationMs;
  const embed = new EmbedBuilder().setColor("#faa81a")
    .setTitle("🎁 GIVEAWAY !")
    .setDescription(`**Prix :** ${prize}\n\n${conditions ? `**Conditions :** ${conditions}\n\n`:""}`+
      `Clique sur 🎁 pour participer !\n\n**Fin :** <t:${Math.floor(endTime/1000)}:R>`)
    .setFooter({ text:"Clique sur le bouton pour participer" }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway_join`).setLabel("🎁 Participer").setStyle(ButtonStyle.Success)
  );
  const msg = await ch.send({ content:"🎉 **GIVEAWAY** 🎉", embeds:[embed], components:[row] });

  const gw = { id:msg.id, channelId:ch.id, prize, endTime, conditions, participants:[], ended:false };
  db.giveaways.push(gw);
  saveData();

  // Timer de fin
  setTimeout(() => endGiveaway(guild, gw.id), durationMs);
  return gw;
}

async function endGiveaway(guild, gwId) {
  const gw = db.giveaways.find(g=>g.id===gwId);
  if(!gw || gw.ended) return;
  gw.ended = true;
  saveData();

  const ch = guild.channels.cache.get(gw.channelId);
  if(!ch) return;

  if(gw.participants.length === 0) {
    ch.send({ embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("🎁 Giveaway terminé").setDescription(`Personne n'a participé au giveaway **${gw.prize}** 😢`)] });
    return;
  }

  const winnerId = gw.participants[rand(0, gw.participants.length-1)];
  const winner = await guild.members.fetch(winnerId).catch(()=>null);
  ch.send({ embeds:[new EmbedBuilder().setColor("#57f287")
    .setTitle("🎉 Giveaway terminé !")
    .setDescription(`🏆 Félicitations à <@${winnerId}> !\n\n**Prix :** ${gw.prize}\n\n${winner?`Contacter <@${OWNER_ID}> pour récupérer ton lot !`:""}`)] });

  await notifyOwner(`🎁 Giveaway terminé !\nPrix : **${gw.prize}**\nGagnant : **${winner?.user.tag||winnerId}**`);
}

// ════════════════════════════════════════════════
//  SONDAGES
// ════════════════════════════════════════════════
async function createPoll(guild, question, options, durationMs) {
  const ch = guild.channels.cache.find(c=>c.name==="💬│général") || guild.channels.cache.find(c=>c.name===CH.welcome);
  if(!ch || options.length < 2 || options.length > 4) return null;

  const endTime = Date.now() + durationMs;
  const embed = new EmbedBuilder().setColor("#5865f2")
    .setTitle(`🗳️ Sondage`)
    .setDescription(`**${question}**\n\nFin : <t:${Math.floor(endTime/1000)}:R>`)
    .setTimestamp();

  options.forEach((o,i) => embed.addFields({ name:`Option ${i+1}`, value:`${["🇦","🇧","🇨","🇩"][i]} ${o} — 0 vote`, inline:true }));

  const row = new ActionRowBuilder().addComponents(
    options.map((o,i) => new ButtonBuilder()
      .setCustomId(`poll_vote_${i}`)
      .setLabel(`${["🇦","🇧","🇨","🇩"][i]} ${o}`)
      .setStyle(ButtonStyle.Primary))
  );

  const msg = await ch.send({ embeds:[embed], components:[row] });
  const poll = { id:msg.id, channelId:ch.id, question, options, votes:options.map(()=>0), voters:{}, endTime, ended:false };
  db.polls.push(poll);
  saveData();

  setTimeout(() => endPoll(guild, poll.id), durationMs);
  return poll;
}

async function endPoll(guild, pollId) {
  const poll = db.polls.find(p=>p.id===pollId);
  if(!poll || poll.ended) return;
  poll.ended = true;
  saveData();

  const ch = guild.channels.cache.get(poll.channelId);
  if(!ch) return;

  const total = poll.votes.reduce((a,b)=>a+b, 0);
  const winnerIdx = poll.votes.indexOf(Math.max(...poll.votes));
  const embed = new EmbedBuilder().setColor("#57f287").setTitle("🗳️ Sondage terminé !")
    .setDescription(`**${poll.question}**\n\n**Gagnant : ${["🇦","🇧","🇨","🇩"][winnerIdx]} ${poll.options[winnerIdx]}** avec ${poll.votes[winnerIdx]} vote(s) !\n\nTotal : ${total} vote(s)`);
  poll.options.forEach((o,i) => {
    const pct = total ? Math.round(poll.votes[i]/total*100) : 0;
    embed.addFields({ name:`${["🇦","🇧","🇨","🇩"][i]} ${o}`, value:`${"█".repeat(Math.round(pct/10))}${"░".repeat(10-Math.round(pct/10))} ${pct}% (${poll.votes[i]})`, inline:false });
  });
  ch.send({ embeds:[embed], components:[] });
}

// ════════════════════════════════════════════════
//  WARNS + PRISON
// ════════════════════════════════════════════════
async function warn(member, reason, guild) {
  const uid=member.user.id;
  if(!db.warns[uid]) db.warns[uid]={count:0,history:[]};
  db.warns[uid].count++;
  db.warns[uid].history.push({reason,time:new Date().toLocaleString("fr-FR")});
  saveData();
  const count=db.warns[uid].count;
  member.user.send(`⚠️ **Avertissement ${count}/${MAX_WARNS}**\nRaison : ${reason}\n${count>=MAX_WARNS?"🔒 Direction la prison !":`${MAX_WARNS-count} warn(s) restant(s).`}`).catch(()=>{});
  const log=guild.channels.cache.find(c=>c.name===CH.logs);
  if(log) log.send({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle(`⚠️ Warn ${count}/${MAX_WARNS} — ${member.user.tag}`).addFields({name:"Raison",value:reason},{name:"Total",value:`${count}/${MAX_WARNS}`,inline:true}).setTimestamp()]});
  await notifyOwner(`⚠️ **Warn** — ${member.user.tag}\nRaison : ${reason}\nTotal : ${count}/${MAX_WARNS}`);
  if(count>=MAX_WARNS){db.warns[uid].count=0;saveData();await prison(member,`${MAX_WARNS} avertissements`,guild);}
}

async function prison(member, reason, guild) {
  try {
    const uid=member.user.id;
    let role=guild.roles.cache.find(r=>r.name===ROLES.prison);
    if(!role){
      role=await guild.roles.create({name:ROLES.prison,color:0x4a4a4a});
      for(const[,ch]of guild.channels.cache){
        if(ch.type===ChannelType.GuildText||ch.type===ChannelType.GuildVoice)
          await ch.permissionOverwrites.edit(role,{ViewChannel:false,Connect:false}).catch(()=>{});
      }
    }
    const backup=member.roles.cache.filter(r=>r.id!==guild.roles.everyone.id&&r.name!==ROLES.prison).map(r=>r.id);
    db.members[uid]={...db.members[uid],rolesBackup:backup};
    saveData();
    await member.roles.set([role]).catch(()=>{});
    const prisonCh=guild.channels.cache.find(c=>c.name===CH.prison);
    if(prisonCh){
      await prisonCh.permissionOverwrites.edit(role,{ViewChannel:true,SendMessages:true}).catch(()=>{});
      prisonCh.send({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("🔒 Nouveau prisonnier !").setDescription(`<@${uid}> en prison.\n**Raison :** ${reason}`).setTimestamp()]});
    }
    const prisonVoc=guild.channels.cache.find(c=>c.name===CH.prisonVoc);
    if(prisonVoc) await prisonVoc.permissionOverwrites.edit(role,{ViewChannel:true,Connect:true,Speak:true}).catch(()=>{});
    const trib=guild.channels.cache.find(c=>c.name===CH.tribunal);
    if(trib) trib.send({
      content:"@here ⚖️ Nouveau prisonnier !",
      embeds:[new EmbedBuilder().setColor("#faa81a").setTitle(`⚖️ Tribunal — ${member.user.tag}`).setDescription(`**Membre :** <@${uid}>\n**Raison :** ${reason}`).setThumbnail(member.user.displayAvatarURL()).setTimestamp()],
      components:[new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`v_free_${uid}`).setLabel("🔓 Liberté").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`v_mute_${uid}`).setLabel("🔇 Mute 24h").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`v_ban_${uid}`).setLabel("🔨 Ban").setStyle(ButtonStyle.Danger),
      )],
    });
    member.user.send(`🔒 Tu as été envoyé en prison.\nRaison : ${reason}`).catch(()=>{});
    db.prisonLogs.push({user:member.user.tag,userId:uid,reason,time:new Date().toLocaleString("fr-FR"),verdict:"En attente"});
    saveData();
    await notifyOwner(`🔒 **Prison** — ${member.user.tag}\nRaison : ${reason}`);
  } catch(e){console.error("⚠️ Prison:",e.message);}
}

// ════════════════════════════════════════════════
//  TWITCH API
// ════════════════════════════════════════════════
function tGet(url,headers){return new Promise((res,rej)=>{const r=https.get(url,{headers},re=>{let b="";re.on("data",d=>b+=d);re.on("end",()=>res(JSON.parse(b)));});r.on("error",rej);});}
function tPost(url){return new Promise((res,rej)=>{const r=https.request(url,{method:"POST"},re=>{let b="";re.on("data",d=>b+=d);re.on("end",()=>res(JSON.parse(b)));});r.on("error",rej);r.end();});}

async function getTwitchToken(){const d=await tPost(`https://id.twitch.tv/oauth2/token?client_id=${cfg.twitch.clientId}&client_secret=${cfg.twitch.clientSecret}&grant_type=client_credentials`);twitchToken=d.access_token;}

async function checkStream() {
  if(!cfg.twitch.clientId||!cfg.twitch.username) return;
  try {
    if(!twitchToken) await getTwitchToken();
    const d=await tGet(`https://api.twitch.tv/helix/streams?user_login=${cfg.twitch.username}`,{"Client-ID":cfg.twitch.clientId,"Authorization":`Bearer ${twitchToken}`});
    if(d.data?.length) {
      const s=d.data[0];
      streamCurrentViewers=s.viewer_count;
      if(s.viewer_count>streamPeakViewers) streamPeakViewers=s.viewer_count;
      if(streamEndTimer){clearTimeout(streamEndTimer);streamEndTimer=null;streamEndTime=null;}
      if(!isLive||lastStreamId!==s.id){
        isLive=true;lastStreamId=s.id;streamStartTime=new Date();streamPeakViewers=s.viewer_count;
        if(cfg.announce) await announceStream(s);
      }
    } else {
      if(isLive&&!streamEndTimer){
        // Sauvegarder les stats du stream
        if(streamStartTime){
          const duration=Math.round((Date.now()-streamStartTime.getTime())/60000);
          db.streamStats.push({date:streamStartTime.toLocaleString("fr-FR"),duration,peakViewers:streamPeakViewers,game:"?"});
          saveData();
          await notifyOwner(`📊 **Stream terminé !**\nDurée : **${duration} min**\nPic spectateurs : **${streamPeakViewers}**`);
        }
        isLive=false;streamEndTime=new Date();streamPeakViewers=0;streamCurrentViewers=0;
        console.log("⏱️ Stream terminé — arrêt IRC dans 1h");
        streamEndTimer=setTimeout(()=>{
          twitchIRCEnabled=false;
          if(twitchBot.socket){twitchBot.socket.destroy();twitchBot.socket=null;}
          twitchBot.connected=false;streamEndTimer=null;streamEndTime=null;
          console.log("🛑 IRC Twitch arrêté automatiquement");
        },60*60*1000);
      } else if(!isLive){isLive=false;}
    }
  } catch(e){twitchToken=null;}
}

async function announceStream(s) {
  try {
    const guild=await client.guilds.fetch(GUILD_ID);
    const ch=guild.channels.cache.find(c=>c.name===CH.live);
    if(!ch) return;
    const embed=new EmbedBuilder().setColor("#9146ff")
      .setTitle(`🔴 ${cfg.twitch.username} est en live !`)
      .setDescription(`**${s.title}**\n\n🎮 ${s.game_name||"?"}\n👥 ${s.viewer_count} spectateurs\n\n[Rejoindre](https://twitch.tv/${cfg.twitch.username})`)
      .setURL(`https://twitch.tv/${cfg.twitch.username}`).setTimestamp();
    if(cfg.thumbnail) embed.setImage(s.thumbnail_url.replace("{width}","1280").replace("{height}","720"));
    await ch.send({
      content:cfg.everyone?"@everyone 🔴 **Live en cours !**":"🔴 **Live en cours !**",
      embeds:[embed],
      components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("🎮 Regarder").setURL(`https://twitch.tv/${cfg.twitch.username}`).setStyle(ButtonStyle.Link))],
    });
    db.streams.push({title:s.title,game:s.game_name||"?",time:new Date().toLocaleString("fr-FR")});
    streamsCount++;saveData();
  } catch(e){console.error("⚠️ Annonce:",e.message);}
}

// ════════════════════════════════════════════════
//  TWITCH CHAT BOT IRC
// ════════════════════════════════════════════════
function connectTwitchIRC() {
  if(!twitchIRCEnabled||!cfg.twitch.botUsername||!cfg.twitch.botToken) return;
  const socket=net.createConnection(6667,"irc.chat.twitch.tv");
  twitchBot.socket=socket;
  socket.on("connect",()=>{
    const tok=cfg.twitch.botToken.startsWith("oauth:")?cfg.twitch.botToken:`oauth:${cfg.twitch.botToken}`;
    socket.write(`PASS ${tok}\r\n`);
    socket.write(`NICK ${cfg.twitch.botUsername}\r\n`);
    socket.write(`JOIN #${cfg.twitch.username.toLowerCase()}\r\n`);
    twitchBot.connected=true;
    console.log(`💜 IRC Twitch : ${cfg.twitch.botUsername}`);
    // Démarrer les rappels si configurés
    if(cfg.twitchChatReminder.enabled) startReminders();
  });
  socket.on("data",data=>{
    const msg=data.toString();
    if(msg.includes("PING")){socket.write("PONG :tmi.twitch.tv\r\n");return;}
    if(msg.includes("PRIVMSG")){
      const m=msg.match(/:(.+)!.+PRIVMSG #\S+ :(.+)/);
      if(m){
        const[,user,text]=m;
        const t=text.trim();
        // Commandes chat
        if(cfg.twitchChatCommands&&AUTO_RESPONSES[t.toLowerCase()]){
          sendIRC(AUTO_RESPONSES[t.toLowerCase()]);return;
        }
        // Modération
        if(cfg.twitchMod){
          const banned=isBanned(t);
          if(banned&&user.toLowerCase()!==cfg.twitch.username.toLowerCase()){
            sendIRC(`/timeout ${user} 600 Mot interdit`);
            sendIRC(`@${user} ⚠️ Message supprimé : contenu interdit.`);
            db.twitchChatLogs.push({message:`🚫 [${user}] : "${banned}"`,time:new Date().toLocaleString("fr-FR"),status:"🚫"});
            saveData();
          }
        }
      }
    }
  });
  socket.on("error",e=>{twitchBot.connected=false;console.error("⚠️ IRC:",e.message);});
  socket.on("close",()=>{
    twitchBot.connected=false;
    if(twitchIRCEnabled){console.log("💔 IRC déconnecté — reconnexion dans 30s");setTimeout(connectTwitchIRC,30000);}
  });
}

function sendIRC(message) {
  if(!twitchBot.socket||!twitchBot.connected) return false;
  twitchBot.socket.write(`PRIVMSG #${cfg.twitch.username.toLowerCase()} :${message}\r\n`);
  db.twitchChatLogs.push({message,time:new Date().toLocaleString("fr-FR"),status:"✅"});
  saveData();return true;
}

function startReminders() {
  if(reminderInterval) clearInterval(reminderInterval);
  if(!cfg.twitchChatReminder.enabled) return;
  reminderInterval=setInterval(()=>{
    if(twitchBot.connected&&isLive) sendIRC(cfg.twitchChatReminder.message);
  },cfg.twitchChatReminder.interval*60*1000);
}

// ════════════════════════════════════════════════
//  DASHBOARD AUTH
// ════════════════════════════════════════════════
function authMiddleware(req, res) {
  const cookie=req.headers.cookie||"";
  const token=cookie.split(";").find(c=>c.trim().startsWith("auth="))?.split("=")[1];
  if(dashSessions.has(token)) return true;
  // Exclure la page de login et l'API login
  if(req.url==="/login"||req.url==="/api/login") return true;
  // Rediriger vers login
  res.writeHead(302,{"Location":"/login"});res.end();
  return false;
}

const LOGIN_PAGE=`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TomBot — Login</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#0d0e10;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Segoe UI',sans-serif;}
.box{background:#2b2d31;border:1px solid #3a3c43;border-radius:12px;padding:40px;width:320px;text-align:center;}
h1{color:#5865f2;font-size:22px;margin-bottom:8px;}p{color:#949ba4;font-size:13px;margin-bottom:24px;}
input{width:100%;background:#1e1f22;border:1px solid #3a3c43;border-radius:6px;padding:12px;color:#dbdee1;font-size:14px;outline:none;margin-bottom:16px;}
input:focus{border-color:#5865f2;}button{width:100%;background:#5865f2;color:white;border:none;border-radius:6px;padding:12px;font-size:15px;font-weight:700;cursor:pointer;}
button:hover{background:#4752c4;}.err{color:#ed4245;font-size:13px;margin-top:12px;}</style></head>
<body><div class="box"><h1>🤖 TomBot</h1><p>Dashboard Tom_O_Carre</p>
<input type="password" id="pwd" placeholder="Mot de passe..." onkeydown="if(event.key==='Enter')login()">
<button onclick="login()">🔓 Connexion</button><div class="err" id="err"></div></div>
<script>async function login(){const p=document.getElementById('pwd').value;
const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})});
const d=await r.json();if(d.ok){location.href='/';}else{document.getElementById('err').textContent='❌ Mot de passe incorrect';}}</script></body></html>`;

// ════════════════════════════════════════════════
//  DASHBOARD SERVEUR WEB
// ════════════════════════════════════════════════
function startDashboard() {
  const ALLOWED=["welcome-bot.js","dashboard.html",".env","package.json","data.json"];
  const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};

  http.createServer((req,res)=>{
    // Page login
    if(req.url==="/login"){res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});return res.end(LOGIN_PAGE);}

    // API login
    if(req.url==="/api/login"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        const{password}=JSON.parse(body||"{}");
        if(password===DASH_PWD){
          const token=Math.random().toString(36).slice(2)+Date.now().toString(36);
          dashSessions.add(token);
          res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`auth=${token};Path=/;HttpOnly;Max-Age=86400`});
          return res.end(JSON.stringify({ok:true}));
        }
        res.writeHead(401,cors);res.end(JSON.stringify({ok:false}));
      });
      return;
    }

    if(!authMiddleware(req,res)) return;

    const url=req.url;

    // ── /api/data ──
    if(url==="/api/data"){
      res.writeHead(200,cors);
      return res.end(JSON.stringify({
        members:Object.keys(db.members).length, deleted, streamsAnnounced:streamsCount,
        qcmValidated:db.qcmMembers.length, logs:db.logs.slice(-50),
        qcmMembers:db.qcmMembers.slice(-50), streams:db.streams.slice(-20),
        bannedWords:db.bannedWords, twitchChatLogs:db.twitchChatLogs.slice(-20),
        prisonLogs:db.prisonLogs.slice(-20), warns:db.warns,
        giveaways:db.giveaways.slice(-10), polls:db.polls.slice(-10),
        streamStats:db.streamStats.slice(-10),
        xpLeaderboard:Object.entries(db.xp).sort((a,b)=>b[1]-a[1]).slice(0,10)
          .map(([id,xp])=>({id,xp,level:getLevel(xp).level,tag:db.members[id]?.tag||id})),
        isLive, streamCurrentViewers, streamPeakViewers,
        twitchBotConnected:twitchBot.connected, twitchIRCEnabled,
        twitchBotUsername:cfg.twitch.botUsername,
        streamEndTime:streamEndTime?streamEndTime.toISOString():null,
        config:{
          twitchUsername:cfg.twitch.username, announceEnabled:cfg.announce,
          mentionEveryone:cfg.everyone, showThumbnail:cfg.thumbnail,
          twitchChatModEnabled:cfg.twitchMod, twitchChatCommands:cfg.twitchChatCommands,
          reminderEnabled:cfg.twitchChatReminder.enabled,
          reminderInterval:cfg.twitchChatReminder.interval,
          reminderMessage:cfg.twitchChatReminder.message,
        },
      }));
    }

    // ── /api/settings ──
    if(url==="/api/settings"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        try{
          const d=JSON.parse(body),env={};
          if(d.discordToken){TOKEN=d.discordToken;env.DISCORD_TOKEN=d.discordToken;}
          if(d.twitchClientId){cfg.twitch.clientId=d.twitchClientId;env.TWITCH_CLIENT_ID=d.twitchClientId;}
          if(d.twitchClientSecret){cfg.twitch.clientSecret=d.twitchClientSecret;env.TWITCH_CLIENT_SECRET=d.twitchClientSecret;}
          if(d.twitchUsername){cfg.twitch.username=d.twitchUsername;env.TWITCH_USERNAME=d.twitchUsername;twitchToken=null;}
          if(d.twitchBotUsername){cfg.twitch.botUsername=d.twitchBotUsername;env.TWITCH_BOT_USERNAME=d.twitchBotUsername;}
          if(d.twitchBotToken){cfg.twitch.botToken=d.twitchBotToken;env.TWITCH_BOT_TOKEN=d.twitchBotToken;if(twitchBot.socket)twitchBot.socket.destroy();setTimeout(connectTwitchIRC,1000);}
          if(d.dashboardPassword){env.DASHBOARD_PASSWORD=d.dashboardPassword;}
          if(typeof d.announceEnabled!=="undefined") cfg.announce=d.announceEnabled;
          if(typeof d.mentionEveryone!=="undefined") cfg.everyone=d.mentionEveryone;
          if(typeof d.showThumbnail!=="undefined") cfg.thumbnail=d.showThumbnail;
          if(typeof d.twitchChatModEnabled!=="undefined") cfg.twitchMod=d.twitchChatModEnabled;
          if(typeof d.twitchChatCommands!=="undefined") cfg.twitchChatCommands=d.twitchChatCommands;
          if(typeof d.reminderEnabled!=="undefined"){cfg.twitchChatReminder.enabled=d.reminderEnabled;startReminders();}
          if(typeof d.reminderInterval!=="undefined"){cfg.twitchChatReminder.interval=d.reminderInterval;startReminders();}
          if(typeof d.reminderMessage!=="undefined") cfg.twitchChatReminder.message=d.reminderMessage;
          if(typeof d.twitchIRCEnabled!=="undefined"){
            twitchIRCEnabled=d.twitchIRCEnabled;
            if(twitchIRCEnabled&&!twitchBot.connected){if(streamEndTimer){clearTimeout(streamEndTimer);streamEndTimer=null;streamEndTime=null;}connectTwitchIRC();}
            else if(!twitchIRCEnabled&&twitchBot.socket){twitchBot.socket.destroy();twitchBot.socket=null;twitchBot.connected=false;if(streamEndTimer){clearTimeout(streamEndTimer);streamEndTimer=null;streamEndTime=null;}}
          }
          if(Object.keys(env).length) saveEnv(env);
          res.writeHead(200,cors);res.end(JSON.stringify({ok:true}));
        }catch(e){res.writeHead(400);res.end("{}");}
      });return;
    }

    // ── Mots bannis ──
    if(url==="/api/words/add"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        try{const{word}=JSON.parse(body);const w=word.trim().toLowerCase();
          if(w&&!db.bannedWords.includes(w)){db.bannedWords.push(w);saveData();res.writeHead(200,cors);res.end(JSON.stringify({ok:true}));}
          else{res.writeHead(400,cors);res.end(JSON.stringify({ok:false,error:"Déjà présent"}));}
        }catch(e){res.writeHead(400);res.end("{}");}
      });return;
    }
    if(url.startsWith("/api/words/remove/")&&req.method==="DELETE"){
      db.bannedWords=db.bannedWords.filter(x=>x!==decodeURIComponent(url.replace("/api/words/remove/","")));
      saveData();res.writeHead(200,cors);return res.end(JSON.stringify({ok:true}));
    }

    // ── Giveaway ──
    if(url==="/api/giveaway/create"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",async()=>{
        try{
          const{prize,duration,conditions,channel}=JSON.parse(body);
          const guild=await client.guilds.fetch(GUILD_ID);
          const gw=await startGiveaway(guild,channel||CH.welcome,prize,duration*60*1000,conditions||"");
          res.writeHead(200,cors);res.end(JSON.stringify({ok:!!gw}));
        }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}
      });return;
    }

    // ── Sondage ──
    if(url==="/api/poll/create"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",async()=>{
        try{
          const{question,options,duration}=JSON.parse(body);
          const guild=await client.guilds.fetch(GUILD_ID);
          const poll=await createPoll(guild,question,options,duration*60*1000);
          res.writeHead(200,cors);res.end(JSON.stringify({ok:!!poll}));
        }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}
      });return;
    }

    // ── Planning stream ──
    if(url==="/api/planning"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",async()=>{
        try{
          const{planning}=JSON.parse(body);
          const guild=await client.guilds.fetch(GUILD_ID);
          const ch=guild.channels.cache.find(c=>c.name===CH.planning);
          if(!ch){res.writeHead(404,cors);return res.end(JSON.stringify({ok:false,error:"Salon planning introuvable"}));}
          const msgs=await ch.messages.fetch({limit:5});
          for(const[,m]of msgs){if(m.author.id===client.user.id)await m.delete().catch(()=>{});}
          await ch.send({embeds:[new EmbedBuilder().setColor("#9146ff")
            .setTitle("📅 Planning des prochains streams")
            .setDescription(planning)
            .setFooter({text:"Tom_O_Carre • Planning"}).setTimestamp()]});
          res.writeHead(200,cors);res.end(JSON.stringify({ok:true}));
        }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}
      });return;
    }

    // ── Twitch message ──
    if(url==="/api/twitch/sendmsg"&&req.method==="POST"){
      let body="";req.on("data",d=>body+=d);
      req.on("end",()=>{
        const{message}=JSON.parse(body||"{}");
        const ok=sendIRC(message||"👋 Test depuis le dashboard !");
        res.writeHead(200,cors);res.end(JSON.stringify({ok}));
      });return;
    }

    // ── Fichiers ──
    if(url==="/api/files"){res.writeHead(200,cors);return res.end(JSON.stringify({files:ALLOWED.map(name=>{const p=path.join(__dirname,name),ex=fs.existsSync(p);return{name,exists:ex,size:ex?fs.statSync(p).size:0,modified:ex?fs.statSync(p).mtime.toLocaleString("fr-FR"):null};})}));}
    if(url.startsWith("/api/files/read/")){const name=decodeURIComponent(url.replace("/api/files/read/",""));if(!ALLOWED.includes(name)){res.writeHead(403);return res.end("{}");}const p=path.join(__dirname,name);res.writeHead(200,cors);return res.end(JSON.stringify({ok:true,content:fs.existsSync(p)?fs.readFileSync(p,"utf8"):"",name}));}
    if(url==="/api/files/save"&&req.method==="POST"){let body="";req.on("data",d=>body+=d);req.on("end",()=>{try{const{name,content}=JSON.parse(body);if(!ALLOWED.includes(name)){res.writeHead(403);return res.end("{}");}const p=path.join(__dirname,name);if(fs.existsSync(p))fs.writeFileSync(p+".backup",fs.readFileSync(p));fs.writeFileSync(p,content);res.writeHead(200,cors);res.end(JSON.stringify({ok:true,message:`${name} sauvegardé !`}));}catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}});return;}
    if(url.startsWith("/api/files/download/")){const name=decodeURIComponent(url.replace("/api/files/download/",""));if(!ALLOWED.includes(name)){res.writeHead(403);return res.end("Interdit");}const p=path.join(__dirname,name);if(!fs.existsSync(p)){res.writeHead(404);return res.end("Introuvable");}res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${name}"`});return res.end(fs.readFileSync(p));}
    if(url==="/api/files/upload"&&req.method==="POST"){let body="";req.on("data",d=>body+=d);req.on("end",()=>{try{const{name,content}=JSON.parse(body);if(!ALLOWED.includes(name)){res.writeHead(403);return res.end("{}");}const p=path.join(__dirname,name);if(fs.existsSync(p))fs.writeFileSync(p+".backup",fs.readFileSync(p));fs.writeFileSync(p,content);res.writeHead(200,cors);res.end(JSON.stringify({ok:true,message:`${name} uploadé !`}));}catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}});return;}

    // ── Logs PM2 ──
    if(url==="/api/logs/pm2"){const home=process.env.HOME||"/root";const out=path.join(home,".pm2/logs/tom-bot-out.log");const err=path.join(home,".pm2/logs/tom-bot-error.log");res.writeHead(200,cors);return res.end(JSON.stringify({logs:fs.existsSync(out)?fs.readFileSync(out,"utf8").split("\n").slice(-50).join("\n"):"",errors:fs.existsSync(err)?fs.readFileSync(err,"utf8").split("\n").slice(-20).join("\n"):""}));}

    // ── Dashboard HTML ──
    if(url==="/"||url==="/index.html"){const p=path.join(__dirname,"dashboard.html");if(fs.existsSync(p)){res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});return res.end(fs.readFileSync(p));}}

    res.writeHead(404);res.end("Not found");
  }).listen(PORT,"0.0.0.0",()=>console.log(`🌐 Dashboard : http://192.168.1.162:${PORT}`));
}

// ════════════════════════════════════════════════
//  CLIENT DISCORD
// ════════════════════════════════════════════════
const client=new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,
           GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],
  rest:{timeout:15000},
});

const RULES_TEXT=`**Règle 1 — Respect**\nInsultes, harcèlement et propos discriminatoires interdits.\n\n**Règle 2 — Pas de spam**\nMessages répétitifs et flood interdits.\n\n**Règle 3 — Pas de publicité**\nAucune pub sans autorisation.\n\n**Règle 4 — Contenu adapté**\nContenu choquant, adulte ou illégal interdit.\n\n**Règle 5 — Français**\nLangue principale du serveur.\n\n**Règle 6 — Bonne ambiance**\nServeur gaming de Tom_O_Carre — sois sympa ! 🎮\n\n_Sanctions : warn → prison → ban_`;

const sessions=new Map();

client.once("clientReady",async()=>{
  console.log(`✅ Bot : ${client.user.tag}`);
  try{
    const guild=await client.guilds.fetch(GUILD_ID);
    const members=await guild.members.fetch();
    members.forEach(m=>{if(!m.user.bot&&!db.members[m.user.id])db.members[m.user.id]={tag:m.user.tag,joinedAt:m.joinedAt?.toISOString()};});
    saveData();
    await setupPrison(guild);
    // Créer salon planning si inexistant
    if(!guild.channels.cache.find(c=>c.name===CH.planning)){
      await guild.channels.create({name:CH.planning,type:ChannelType.GuildText,topic:"Planning des prochains streams"});
      console.log("📅 Salon planning créé");
    }
    // Créer rôles XP si inexistants
    for(const l of XP_LEVELS){
      if(!guild.roles.cache.find(r=>r.name===l.role)){
        await guild.roles.create({name:l.role}).catch(()=>{});
      }
    }
    // Poster règles
    const rulesCh=guild.channels.cache.find(c=>c.name===CH.rules);
    if(rulesCh){
      const msgs=await rulesCh.messages.fetch({limit:10});
      if(!msgs.some(m=>m.author.id===client.user.id&&m.components.length>0)){
        await rulesCh.send({
          embeds:[new EmbedBuilder().setColor("#5865f2").setTitle("📜 Règles — Tom_O_Carre").setDescription(RULES_TEXT).setFooter({text:"Lis avant de participer !"})],
          components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("start_qcm").setLabel("✅ J'ai lu — Passer le QCM").setStyle(ButtonStyle.Success))],
        });
        console.log("📜 Règles postées");
      }else{console.log("📜 Règles déjà présentes");}
    }
  }catch(e){console.error("⚠️ Init:",e.message);}

  await checkStream();
  setInterval(checkStream,3*60*1000);
  startDashboard();
  connectTwitchIRC();

  // Nettoyage mémoire toutes les 30 min
  setInterval(()=>{
    if(global.gc) global.gc();
    if(db.logs.length>500) db.logs=db.logs.slice(-200);
    if(db.twitchChatLogs.length>200) db.twitchChatLogs=db.twitchChatLogs.slice(-100);
    if(db.xpCooldowns) Object.keys(db.xpCooldowns).forEach(k=>{if(Date.now()-db.xpCooldowns[k]>XP_COOLDOWN*2)delete db.xpCooldowns[k];});
    saveData();
  },30*60*1000);
});

async function setupPrison(guild){
  let role=guild.roles.cache.find(r=>r.name===ROLES.prison);
  if(!role){role=await guild.roles.create({name:ROLES.prison,color:0x4a4a4a});for(const[,ch]of guild.channels.cache){if(ch.type===ChannelType.GuildText||ch.type===ChannelType.GuildVoice)await ch.permissionOverwrites.edit(role,{ViewChannel:false,Connect:false}).catch(()=>{});}}
  const modoRole=guild.roles.cache.find(r=>r.name===ROLES.modo);const everyone=guild.roles.everyone;
  let cat=guild.channels.cache.find(c=>c.name==="🔒 PRISON"&&c.type===ChannelType.GuildCategory);
  if(!cat){cat=await guild.channels.create({name:"🔒 PRISON",type:ChannelType.GuildCategory,permissionOverwrites:[{id:everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:role.id,allow:[PermissionsBitField.Flags.ViewChannel]},...(modoRole?[{id:modoRole.id,allow:[PermissionsBitField.Flags.ViewChannel]}]:[])]});}
  if(!guild.channels.cache.find(c=>c.name===CH.prison)){await guild.channels.create({name:CH.prison,type:ChannelType.GuildText,parent:cat.id,permissionOverwrites:[{id:everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:role.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]},...(modoRole?[{id:modoRole.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ManageMessages]}]:[])]});}
  if(!guild.channels.cache.find(c=>c.name===CH.prisonVoc)){await guild.channels.create({name:CH.prisonVoc,type:ChannelType.GuildVoice,parent:cat.id,permissionOverwrites:[{id:everyone.id,deny:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect]},{id:role.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.Speak]},...(modoRole?[{id:modoRole.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.Speak,PermissionsBitField.Flags.MuteMembers]}]:[])]});}
  if(!guild.channels.cache.find(c=>c.name===CH.tribunal)){const modoCat=guild.channels.cache.find(c=>c.name==="🛡️ MODÉRATION"&&c.type===ChannelType.GuildCategory);await guild.channels.create({name:CH.tribunal,type:ChannelType.GuildText,parent:modoCat?.id||cat.id,permissionOverwrites:[{id:everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},...(modoRole?[{id:modoRole.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]}]:[])]});}
  console.log("🔒 Prison vérifiée");
}

// Nouveau membre
client.on("guildMemberAdd",async member=>{
  if(member.user.bot) return;
  db.members[member.user.id]={tag:member.user.tag,joinedAt:new Date().toISOString()};
  saveData();
  const ch=member.guild.channels.cache.find(c=>c.name===CH.welcome);if(!ch)return;
  const rules=member.guild.channels.cache.find(c=>c.name===CH.rules);
  ch.send({embeds:[new EmbedBuilder().setColor("#9146ff").setTitle("🎮 Bienvenue sur Tom_O_Carre !").setDescription(`Hey <@${member.id}> ! 🎉\n\nVa dans ${rules?`<#${rules.id}>`:"#règles"} pour lire les règles et passer le QCM. 🚀`).setThumbnail(member.user.displayAvatarURL()).setFooter({text:`Membre #${member.guild.memberCount}`}).setTimestamp()]});
  await notifyOwner(`👋 **Nouveau membre** : ${member.user.tag}`);
});

// Messages
client.on("messageCreate",async msg=>{
  if(msg.author.bot) return;
  const banned=isBanned(msg.content);
  if(banned){
    try{
      await msg.delete();
      const w=await msg.channel.send({embeds:[new EmbedBuilder().setColor("#ed4245").setDescription(`🚫 <@${msg.author.id}> — Message supprimé.`)]});
      setTimeout(()=>w.delete().catch(()=>{}),5000);
      const member=await msg.guild.members.fetch(msg.author.id);
      await warn(member,`Mot interdit : "${banned}"`,msg.guild);
      db.logs.push({user:msg.author.tag,word:banned,channel:msg.channel.name,time:new Date().toLocaleString("fr-FR")});
      deleted++;saveData();
    }catch(e){console.error("⚠️ Censure:",e.message);}
    return;
  }

  // Auto-réponses Discord
  const cmd=msg.content.toLowerCase().trim();
  if(AUTO_RESPONSES[cmd]){msg.reply(AUTO_RESPONSES[cmd]).catch(()=>{});return;}

  // Commandes fun
  if(cmd==="!dice"){msg.reply(`🎲 Tu as obtenu : **${rand(1,6)}**`).catch(()=>{});return;}
  if(cmd==="!8ball"){
    const answers=["Oui !","Non...","Peut-être","Absolument !","Je ne pense pas","Sans aucun doute !","C'est flou...","Certainement pas !"];
    msg.reply(`🎱 ${answers[rand(0,answers.length-1)]}`).catch(()=>{});return;
  }
  if(cmd.startsWith("!rank")){
    const uid=msg.author.id;const xp=db.xp[uid]||0;const level=getLevel(xp);const next=getNextLevel(xp);
    msg.reply({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle(`⭐ Rang de ${msg.author.tag}`).addFields({name:"Niveau",value:`${level.level}`,inline:true},{name:"XP",value:`${xp}`,inline:true},{name:"Prochain niveau",value:next?`${xp}/${next.xp} XP`:"MAX",inline:true})]}).catch(()=>{});return;
  }
  if(cmd==="!top"){
    const top=Object.entries(db.xp).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const desc=top.map(([id,xp],i)=>`${["🥇","🥈","🥉","4️⃣","5️⃣"][i]} <@${id}> — **${xp} XP** (Niv. ${getLevel(xp).level})`).join("\n");
    msg.reply({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle("🏆 Top 5 XP").setDescription(desc||"Aucun membre")]}).catch(()=>{});return;
  }

  // XP
  const member=await msg.guild.members.fetch(msg.author.id).catch(()=>null);
  if(member) await addXP(member,msg.guild);
});

// Interactions
client.on("interactionCreate",async interaction=>{
  if(!interaction.isButton()) return;
  const uid=interaction.user.id;const guild=interaction.guild;

  // QCM
  if(interaction.customId==="start_qcm"){
    sessions.set(uid,{step:0});
    const q=QCM_QUESTIONS[0];const shuffled=[...q.a].sort(()=>Math.random()-0.5);
    sessions.get(uid).shuffled=shuffled;
    await interaction.reply({embeds:[new EmbedBuilder().setColor("#5865f2").setTitle(`📋 QCM — Q1/${QCM_QUESTIONS.length}`).setDescription(q.q).setFooter({text:"Tom_O_Carre • Vérification"})],components:[new ActionRowBuilder().addComponents(shuffled.map((a,i)=>new ButtonBuilder().setCustomId(`qcm_${uid}_${i}`).setLabel(a.l).setStyle(ButtonStyle.Primary)))],flags:64}).catch(()=>{});
    return;
  }

  if(interaction.customId.startsWith(`qcm_${uid}_`)){
    await interaction.deferUpdate().catch(()=>{});
    const session=sessions.get(uid);
    if(!session){await interaction.editReply({content:"❌ Session expirée. Reclique sur le bouton.",components:[]}).catch(()=>{});return;}
    const idx=parseInt(interaction.customId.split("_").pop());
    const chosen=session.shuffled[idx];
    if(chosen.ok){
      session.step++;
      if(session.step<QCM_QUESTIONS.length){
        const q=QCM_QUESTIONS[session.step];const shuffled=[...q.a].sort(()=>Math.random()-0.5);session.shuffled=shuffled;
        await interaction.editReply({embeds:[new EmbedBuilder().setColor("#5865f2").setTitle(`📋 QCM — Q${session.step+1}/${QCM_QUESTIONS.length}`).setDescription(q.q).setFooter({text:"Tom_O_Carre • Vérification"})],components:[new ActionRowBuilder().addComponents(shuffled.map((a,i)=>new ButtonBuilder().setCustomId(`qcm_${uid}_${i}`).setLabel(a.l).setStyle(ButtonStyle.Primary)))]}).catch(()=>{});
      }else{
        sessions.delete(uid);
        try{const member=await guild.members.fetch(uid);const role=guild.roles.cache.find(r=>r.name===ROLES.member);if(role)await member.roles.add(role);db.qcmMembers.push({name:member.user.tag,date:new Date().toLocaleString("fr-FR")});db.members[uid]={...db.members[uid],qcmPassed:true};saveData();const log=guild.channels.cache.find(c=>c.name===CH.logs);if(log)log.send(`✅ **${member.user.tag}** a validé le QCM → **${ROLES.member}**`);}catch(e){}
        await interaction.editReply({embeds:[new EmbedBuilder().setColor("#57f287").setTitle("✅ QCM réussi !").setDescription("Bienvenue dans la communauté Tom_O_Carre ! 🎮")],components:[]}).catch(()=>{});
      }
    }else{
      sessions.delete(uid);
      await interaction.editReply({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("❌ Mauvaise réponse !").setDescription("Relis les règles et réessaie.")],components:[]}).catch(()=>{});
    }
    return;
  }

  // Giveaway participation
  if(interaction.customId==="giveaway_join"){
    await interaction.deferReply({flags:64}).catch(()=>{});
    const gw=db.giveaways.find(g=>g.id===interaction.message.id&&!g.ended);
    if(!gw){await interaction.editReply({content:"❌ Ce giveaway est terminé."}).catch(()=>{});return;}
    if(gw.participants.includes(uid)){await interaction.editReply({content:"✅ Tu participes déjà !"}).catch(()=>{});return;}
    gw.participants.push(uid);saveData();
    await interaction.editReply({content:`🎁 Tu participes au giveaway **${gw.prize}** ! Bonne chance ! (${gw.participants.length} participants)`}).catch(()=>{});
    return;
  }

  // Vote sondage
  if(interaction.customId.startsWith("poll_vote_")){
    await interaction.deferReply({flags:64}).catch(()=>{});
    const optIdx=parseInt(interaction.customId.replace("poll_vote_",""));
    const poll=db.polls.find(p=>p.id===interaction.message.id&&!p.ended);
    if(!poll){await interaction.editReply({content:"❌ Sondage terminé."}).catch(()=>{});return;}
    if(poll.voters[uid]!==undefined){
      poll.votes[poll.voters[uid]]--;
    }
    poll.voters[uid]=optIdx;poll.votes[optIdx]++;saveData();
    await interaction.editReply({content:`✅ Vote enregistré : **${["🇦","🇧","🇨","🇩"][optIdx]} ${poll.options[optIdx]}**`}).catch(()=>{});
    return;
  }

  // Tribunal
  if(interaction.customId.startsWith("v_")){
    const[,verdict,targetId]=interaction.customId.split("_");
    await interaction.deferUpdate().catch(()=>{});
    try{
      const target=await guild.members.fetch(targetId);
      const prisonRole=guild.roles.cache.find(r=>r.name===ROLES.prison);
      const memberRole=guild.roles.cache.find(r=>r.name===ROLES.member);
      const log=guild.channels.cache.find(c=>c.name===CH.logs);
      const entry=db.prisonLogs.find(p=>p.userId===targetId&&p.verdict==="En attente");
      if(verdict==="free"){
        if(prisonRole) await target.roles.remove(prisonRole).catch(()=>{});
        const backup=db.members[targetId]?.rolesBackup||[];
        for(const rid of backup){const r=guild.roles.cache.get(rid);if(r)await target.roles.add(r).catch(()=>{});}
        target.user.send("🔓 Tu es libre ! Bienvenue de retour.").catch(()=>{});
        if(entry) entry.verdict=`🔓 Liberté (${interaction.user.tag})`;
        await interaction.editReply({embeds:[new EmbedBuilder().setColor("#57f287").setTitle("⚖️ Liberté").setDescription(`<@${targetId}> est libre.`)],components:[]});
      }else if(verdict==="mute"){
        await target.timeout(24*60*60*1000,"Tribunal").catch(()=>{});
        if(prisonRole) await target.roles.remove(prisonRole).catch(()=>{});
        if(memberRole) await target.roles.add(memberRole).catch(()=>{});
        target.user.send("🔇 Verdict : Mute 24h.").catch(()=>{});
        if(entry) entry.verdict=`🔇 Mute 24h (${interaction.user.tag})`;
        await interaction.editReply({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle("⚖️ Mute 24h").setDescription(`<@${targetId}> est mute 24h.`)],components:[]});
      }else if(verdict==="ban"){
        target.user.send("🔨 Verdict : Ban permanent.").catch(()=>{});
        await guild.members.ban(targetId,{reason:`Tribunal — ${interaction.user.tag}`});
        if(entry) entry.verdict=`🔨 Ban (${interaction.user.tag})`;
        await interaction.editReply({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("⚖️ Ban").setDescription(`<@${targetId}> a été banni.`)],components:[]});
      }
      saveData();
      if(log) log.send(`⚖️ Verdict : <@${targetId}> → **${verdict}** par <@${interaction.user.id}>`);
      await notifyOwner(`⚖️ **Tribunal** — ${target.user.tag} → **${verdict}** par ${interaction.user.tag}`);
    }catch(e){console.error("⚠️ Tribunal:",e.message);}
  }
});

client.login(TOKEN);
