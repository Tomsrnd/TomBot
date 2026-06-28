// ════════════════════════════════════════════════
//  TOMBOT v4.0 — QCM avec IA Google Gemini
//  Optimisé Raspberry Pi 2
// ════════════════════════════════════════════════
const fs   = require("fs");
const path = require("path");
const https = require("https");
const http  = require("http");
const net   = require("net");

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
const PORT     = parseInt(process.env.DASHBOARD_PORT || "3000");
const DASH_PWD = process.env.DASHBOARD_PASSWORD || "tombot2024";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";

const CH = {
  welcome:"👋│présentations", rules:"📜│règles", logs:"📋│logs",
  live:"📡│live-maintenant", prison:"🔒│prison", prisonVoc:"🔒│vocal-prison",
  tribunal:"⚖️│tribunal", planning:"📅│planning-stream",
};
const ROLES = { member:"🌱 Nouveau", prison:"🔒 Prisonnier", modo:"🛡️ Modérateur" };
const MAX_WARNS = 3;
const DATA_FILE = path.join(__dirname, "data.json");

const RULES_TEXT = `**Règle 1 — Respect** : Insultes, harcèlement et propos discriminatoires interdits.
**Règle 2 — Pas de spam** : Messages répétitifs et flood interdits.
**Règle 3 — Pas de publicité** : Aucune pub sans autorisation.
**Règle 4 — Contenu adapté** : Contenu choquant, adulte ou illégal interdit.
**Règle 5 — Français** : Langue principale du serveur.
**Règle 6 — Bonne ambiance** : Serveur gaming de Tom_O_Carre — sois sympa !`;

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
};

let twitchToken=null, isLive=false, lastStreamId=null;
let streamEndTimer=null, twitchIRCEnabled=false, streamEndTime=null;
let streamStartTime=null, streamPeakViewers=0, streamCurrentViewers=0;
const twitchBot = { socket:null, connected:false };
let deleted=0, streamsCount=0;

// Sessions QCM avec IA
const qcmSessions = new Map(); // { userId: { questions: [], answers: {}, step: 0, phase: 'answering'|'checking' } }

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

async function notifyOwner(message) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    await owner.send(message);
  } catch(e) {}
}

// ════════════════════════════════════════════════
//  GOOGLE GEMINI AI — QCM
// ════════════════════════════════════════════════
function callGeminiAPI(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
      method: 'POST',
      headers: {
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
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
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
  const prompt = `Génère 3 questions de contrôle QCM sur ces règles de serveur Discord :
${RULES_TEXT}

Format de réponse JSON STRICT (sans markdown, juste du JSON valide) :
{
  "questions": [
    {
      "question": "Question 1?",
      "options": [
        {"text": "Option A", "correct": true},
        {"text": "Option B", "correct": false},
        {"text": "Option C", "correct": false}
      ]
    },
    ... (3 questions au total)
  ]
}

Les questions doivent être différentes à chaque fois. Les options doivent être en français.`;

  try {
    const response = await callGeminiAPI(prompt);
    // Extraire JSON du texte
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Pas de JSON trouvé");
    const qcm = JSON.parse(jsonMatch[0]);
    if (!qcm.questions || qcm.questions.length !== 3) throw new Error("Pas 3 questions");
    return qcm;
  } catch(e) {
    console.error("⚠️ Gemini error:", e.message);
    return null;
  }
}

async function checkAnswer(questionIndex, userAnswer, qcm) {
  const question = qcm.questions[questionIndex];
  const prompt = `L'utilisateur a répondu à cette question de quiz :
Énoncé : "${question.question}"
Options :
${question.options.map((o, i) => `${String.fromCharCode(65+i)}. ${o.text}`).join('\n')}
Réponse de l'utilisateur : "${userAnswer}"

Réponds UNIQUEMENT par "CORRECT" si la réponse est juste, ou "INCORRECT" si elle est fausse. Sois strict et pédagogue.`;

  try {
    const response = await callGeminiAPI(prompt);
    return response.includes("CORRECT");
  } catch(e) {
    console.error("⚠️ Check answer error:", e.message);
    return false;
  }
}

// ════════════════════════════════════════════════
//  WARNS + PRISON (simplifié)
// ════════════════════════════════════════════════
async function warn(member, reason, guild) {
  const uid=member.user.id;
  if(!db.warns[uid]) db.warns[uid]={count:0,history:[]};
  db.warns[uid].count++;
  db.warns[uid].history.push({reason,time:new Date().toLocaleString("fr-FR")});
  saveData();
  const count=db.warns[uid].count;
  member.user.send(`⚠️ **Avertissement ${count}/${MAX_WARNS}**\nRaison : ${reason}`).catch(()=>{});
  const log=guild.channels.cache.find(c=>c.name===CH.logs);
  if(log) log.send({embeds:[new EmbedBuilder().setColor("#faa81a").setTitle(`⚠️ Warn ${count}/${MAX_WARNS}`).addFields({name:"Raison",value:reason}).setTimestamp()]});
  await notifyOwner(`⚠️ **Warn** — ${member.user.tag}\nRaison : ${reason}\nTotal : ${count}/${MAX_WARNS}`);
  if(count>=MAX_WARNS){db.warns[uid].count=0;saveData();await prison(member,`${MAX_WARNS} avertissements`,guild);}
}

async function prison(member, reason, guild) {
  try {
    const uid=member.user.id;
    let role=guild.roles.cache.find(r=>r.name===ROLES.prison);
    if(!role){role=await guild.roles.create({name:ROLES.prison,color:0x4a4a4a});for(const[,ch]of guild.channels.cache){if(ch.type===ChannelType.GuildText||ch.type===ChannelType.GuildVoice)await ch.permissionOverwrites.edit(role,{ViewChannel:false,Connect:false}).catch(()=>{});}}
    const backup=member.roles.cache.filter(r=>r.id!==guild.roles.everyone.id&&r.name!==ROLES.prison).map(r=>r.id);
    db.members[uid]={...db.members[uid],rolesBackup:backup};
    saveData();
    await member.roles.set([role]).catch(()=>{});
    const prisonCh=guild.channels.cache.find(c=>c.name===CH.prison);
    if(prisonCh){await prisonCh.permissionOverwrites.edit(role,{ViewChannel:true,SendMessages:true}).catch(()=>{});prisonCh.send({embeds:[new EmbedBuilder().setColor("#ed4245").setTitle("🔒 Prison").setDescription(`<@${uid}> — ${reason}`).setTimestamp()]});}
    member.user.send(`🔒 Tu as été envoyé en prison.\nRaison : ${reason}`).catch(()=>{});
    db.prisonLogs.push({user:member.user.tag,userId:uid,reason,time:new Date().toLocaleString("fr-FR"),verdict:"En attente"});
    saveData();
    await notifyOwner(`🔒 **Prison** — ${member.user.tag}\nRaison : ${reason}`);
  } catch(e){console.error("⚠️ Prison:",e.message);}
}

// ════════════════════════════════════════════════
//  TWITCH (simplifié)
// ════════════════════════════════════════════════
function tGet(url,headers){return new Promise((res,rej)=>{const r=https.get(url,{headers},re=>{let b="";re.on("data",d=>b+=d);re.on("end",()=>res(JSON.parse(b)));});r.on("error",rej);});}
async function getTwitchToken(){const d=await tGet(`https://id.twitch.tv/oauth2/token?client_id=${cfg.twitch.clientId}&client_secret=${cfg.twitch.clientSecret}&grant_type=client_credentials`).catch(()=>({}));twitchToken=d.access_token;}
async function checkStream(){if(!cfg.twitch.clientId||!cfg.twitch.username)return;try{if(!twitchToken)await getTwitchToken();const d=await tGet(`https://api.twitch.tv/helix/streams?user_login=${cfg.twitch.username}`,{"Client-ID":cfg.twitch.clientId,"Authorization":`Bearer ${twitchToken}`}).catch(()=>({data:[]}));if(d.data?.length){isLive=true;}else{isLive=false;}}catch(e){twitchToken=null;}}

// ════════════════════════════════════════════════
//  DASHBOARD SERVEUR WEB
// ════════════════════════════════════════════════
function startDashboard() {
  const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};
  const ALLOWED=["welcome-bot.js","dashboard.html",".env","package.json","data.json"];

  http.createServer((req,res)=>{
    const url=req.url;

    if(url==="/login"){res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});return res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TomBot Login</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#0d0e10;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}div{background:#2b2d31;border-radius:12px;padding:40px;width:320px;text-align:center;}h1{color:#5865f2;margin-bottom:8px;}p{color:#949ba4;font-size:13px;margin-bottom:24px;}input{width:100%;background:#1e1f22;border:1px solid #3a3c43;border-radius:6px;padding:12px;color:#dbdee1;outline:none;margin-bottom:16px;}button{width:100%;background:#5865f2;color:white;border:none;border-radius:6px;padding:12px;font-weight:700;cursor:pointer;}button:hover{background:#4752c4;}.err{color:#ed4245;font-size:13px;margin-top:12px;}</style></head><body><div><h1>🤖 TomBot</h1><p>Dashboard</p><input type="password" id="p" placeholder="Mot de passe..." onkeydown="if(event.key==='Enter')login()"><button onclick="login()">Connexion</button><div class="err" id="e"></div></div><script>if(document.cookie.includes('auth='))location.href='/';async function login(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('p').value})});const d=await r.json();if(d.ok)location.href='/';else document.getElementById('e').textContent='❌ Incorrect';}</script></body></html>`);}

    if(url==="/api/login"&&req.method==="POST"){let b="";req.on("data",d=>b+=d);req.on("end",()=>{const{password}=JSON.parse(b||"{}");if(password===DASH_PWD){const t=Math.random().toString(36).slice(2)+Date.now().toString(36);dashSessions.add(t);res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`auth=${t};Path=/;HttpOnly;Max-Age=86400`});return res.end(JSON.stringify({ok:true}));}res.writeHead(401,cors);res.end(JSON.stringify({ok:false}));});return;}

    const cookie=req.headers.cookie||"";const token=cookie.split(";").find(c=>c.trim().startsWith("auth="))?.split("=")[1];if(!dashSessions.has(token)){res.writeHead(302,{"Location":"/login"});res.end();return;}

    if(url==="/api/data"){res.writeHead(200,cors);return res.end(JSON.stringify({members:Object.keys(db.members).length,deleted,streamsAnnounced:streamsCount,qcmValidated:db.qcmMembers.length,logs:db.logs.slice(-50),qcmMembers:db.qcmMembers.slice(-50),prisonLogs:db.prisonLogs.slice(-20),warns:db.warns,isLive}));}

    if(url==="/api/settings"&&req.method==="POST"){let b="";req.on("data",d=>b+=d);req.on("end",()=>{try{const d=JSON.parse(b),e={};if(d.discordToken){TOKEN=d.discordToken;e.DISCORD_TOKEN=d.discordToken;}if(d.dashboardPassword)e.DASHBOARD_PASSWORD=d.dashboardPassword;if(Object.keys(e).length)saveEnv(e);res.writeHead(200,cors);res.end(JSON.stringify({ok:true}));}catch(e){res.writeHead(400);res.end("{}");}});return;}

    if(url==="/api/words/add"&&req.method==="POST"){let b="";req.on("data",d=>b+=d);req.on("end",()=>{try{const{word}=JSON.parse(b);const w=word.trim().toLowerCase();if(w&&!db.bannedWords.includes(w)){db.bannedWords.push(w);saveData();res.writeHead(200,cors);res.end(JSON.stringify({ok:true}));}else{res.writeHead(400,cors);res.end(JSON.stringify({ok:false,error:"Déjà présent"}));}}catch(e){res.writeHead(400);res.end("{}");}});return;}

    if(url.startsWith("/api/words/remove/")&&req.method==="DELETE"){db.bannedWords=db.bannedWords.filter(x=>x!==decodeURIComponent(url.replace("/api/words/remove/","")));saveData();res.writeHead(200,cors);return res.end(JSON.stringify({ok:true}));}

    if(url==="/api/files"){res.writeHead(200,cors);return res.end(JSON.stringify({files:ALLOWED.map(name=>{const p=path.join(__dirname,name),ex=fs.existsSync(p);return{name,exists:ex,size:ex?fs.statSync(p).size:0,modified:ex?fs.statSync(p).mtime.toLocaleString("fr-FR"):null};})}));}

    if(url.startsWith("/api/files/read/")){const name=decodeURIComponent(url.replace("/api/files/read/",""));if(!ALLOWED.includes(name)){res.writeHead(403);return res.end("{}");}const p=path.join(__dirname,name);res.writeHead(200,cors);return res.end(JSON.stringify({ok:true,content:fs.existsSync(p)?fs.readFileSync(p,"utf8"):"",name}));}

    if(url==="/api/files/save"&&req.method==="POST"){let b="";req.on("data",d=>b+=d);req.on("end",()=>{try{const{name,content}=JSON.parse(b);if(!ALLOWED.includes(name)){res.writeHead(403);return res.end("{}");}const p=path.join(__dirname,name);if(fs.existsSync(p))fs.writeFileSync(p+".backup",fs.readFileSync(p));fs.writeFileSync(p,content);res.writeHead(200,cors);res.end(JSON.stringify({ok:true}));}catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}});return;}

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

client.once("clientReady",async()=>{
  console.log(`✅ Bot : ${client.user.tag}`);
  try{
    const guild=await client.guilds.fetch(GUILD_ID);
    const members=await guild.members.fetch();
    members.forEach(m=>{if(!m.user.bot&&!db.members[m.user.id])db.members[m.user.id]={tag:m.user.tag,joinedAt:m.joinedAt?.toISOString()};});
    saveData();

    // Créer salon prison
    let prisonRole=guild.roles.cache.find(r=>r.name===ROLES.prison);
    if(!prisonRole)prisonRole=await guild.roles.create({name:ROLES.prison,color:0x4a4a4a});
    if(!guild.channels.cache.find(c=>c.name===CH.prison)){
      const cat=guild.channels.cache.find(c=>c.name==="🔒 PRISON"&&c.type===ChannelType.GuildCategory)||
                await guild.channels.create({name:"🔒 PRISON",type:ChannelType.GuildCategory});
      await guild.channels.create({name:CH.prison,type:ChannelType.GuildText,parent:cat.id});
    }

    // Poster règles
    const rulesCh=guild.channels.cache.find(c=>c.name===CH.rules);
    if(rulesCh){
      const msgs=await rulesCh.messages.fetch({limit:10});
      if(!msgs.some(m=>m.author.id===client.user.id&&m.components.length>0)){
        await rulesCh.send({
          embeds:[new EmbedBuilder().setColor("#5865f2").setTitle("📜 Règles").setDescription(RULES_TEXT).setFooter({text:"Clique sur le bouton pour passer le QCM"})],
          components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("start_qcm_ai").setLabel("✅ Passer le QCM").setStyle(ButtonStyle.Success))],
        });
        console.log("📜 Règles postées");
      }
    }
  }catch(e){console.error("⚠️ Init:",e.message);}

  await checkStream();
  setInterval(checkStream,3*60*1000);
  startDashboard();

  setInterval(()=>{if(global.gc)global.gc();if(db.logs.length>500)db.logs=db.logs.slice(-200);saveData();},30*60*1000);
});

client.on("guildMemberAdd",async member=>{
  if(member.user.bot)return;
  db.members[member.user.id]={tag:member.user.tag,joinedAt:new Date().toISOString()};
  saveData();
  const ch=member.guild.channels.cache.find(c=>c.name===CH.welcome);
  if(!ch)return;
  ch.send({embeds:[new EmbedBuilder().setColor("#9146ff").setTitle("🎮 Bienvenue !").setDescription(`Hey <@${member.id}> !\n\nVa dans #📜│règles pour lire les règles et passer le QCM. 🚀`).setThumbnail(member.user.displayAvatarURL()).setTimestamp()]});
  await notifyOwner(`👋 **Nouveau membre** : ${member.user.tag}`);
});

// Censure
client.on("messageCreate",async msg=>{
  if(msg.author.bot)return;
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
  }
});

// Interactions QCM avec IA
client.on("interactionCreate",async interaction=>{
  if(!interaction.isButton())return;
  const uid=interaction.user.id;
  const guild=interaction.guild;

  // Démarrer QCM IA
  if(interaction.customId==="start_qcm_ai"){
    await interaction.deferReply({flags:64});
    try{
      // Générer les questions avec l'IA
      await interaction.editReply({content:"⏳ Génération des questions en cours..."});
      const qcm=await generateQCM();
      if(!qcm){await interaction.editReply({content:"❌ Erreur lors de la génération du QCM"});return;}

      qcmSessions.set(uid,{qcm,step:0,correct:0});
      await interaction.user.send({embeds:[new EmbedBuilder().setColor("#5865f2")
        .setTitle(`📋 QCM — Question 1/3`)
        .setDescription(qcm.questions[0].question)
        .addFields({name:"Instructions",value:"Réponds par A, B ou C en message privé"})
        .setFooter({text:"Tom_O_Carre"})]});
      
      await interaction.editReply({content:"✅ QCM lancé ! Un message privé t'a été envoyé avec la première question."});
    }catch(e){
      console.error("QCM error:",e.message);
      await interaction.editReply({content:"❌ Erreur"});
    }
    return;
  }

  // Validation manuelle
  if(interaction.customId.startsWith("validate_qcm_")){
    const targetId=interaction.customId.replace("validate_qcm_","");
    try{
      const member=await guild.members.fetch(targetId);
      const role=guild.roles.cache.find(r=>r.name===ROLES.member);
      if(role)await member.roles.add(role);
      db.qcmMembers.push({name:member.user.tag,date:new Date().toLocaleString("fr-FR")});
      db.members[targetId]={...db.members[targetId],qcmPassed:true};
      saveData();
      await interaction.reply({content:`✅ ${member.user.tag} validé !`,flags:64});
    }catch(e){await interaction.reply({content:"❌ Erreur",flags:64});}
  }
});

// Réponses aux messages privés (réponses QCM)
client.on("messageCreate",async msg=>{
  if(msg.author.bot||msg.guild)return;
  const uid=msg.author.id;
  const session=qcmSessions.get(uid);
  if(!session)return;

  const answer=msg.content.toUpperCase().trim();
  if(!["A","B","C"].includes(answer)){msg.reply("❌ Réponds par A, B ou C").catch(()=>{});return;}

  try{
    await msg.react("⏳");
    const isCorrect=await checkAnswer(session.step,answer,session.qcm);

    if(isCorrect){
      session.correct++;
      session.step++;
      await msg.react("✅");

      if(session.step<3){
        await msg.reply({embeds:[new EmbedBuilder().setColor("#57f287").setTitle(`✅ Correct !`).setDescription(`**Question ${session.step+1}/3**\n${session.qcm.questions[session.step].question}`)]});
      }else{
        // QCM réussi !
        const guild=await client.guilds.fetch(GUILD_ID);
        const member=await guild.members.fetch(uid).catch(()=>null);
        if(member){
          const role=guild.roles.cache.find(r=>r.name===ROLES.member);
          if(role)await member.roles.add(role);
          db.qcmMembers.push({name:member.user.tag,date:new Date().toLocaleString("fr-FR")});
          db.members[uid]={...db.members[uid],qcmPassed:true};
          saveData();
        }
        await msg.reply({embeds:[new EmbedBuilder().setColor("#57f287").setTitle("✅ QCM réussi !").setDescription("Bienvenue dans la communauté Tom_O_Carre ! 🎮")]});
        qcmSessions.delete(uid);
        await notifyOwner(`✅ **QCM réussi** — ${msg.author.tag}`);
      }
    }else{
      await msg.react("❌");
      await msg.reply("❌ Mauvaise réponse. Réessaie !");
    }
  }catch(e){
    console.error("QCM check error:",e.message);
    msg.reply("❌ Erreur lors de la vérification").catch(()=>{});
  }
});

// Commande !validateqcm
client.on("messageCreate",async msg=>{
  if(msg.author.bot)return;
  if(!msg.content.startsWith("!validateqcm"))return;
  const modoRole=msg.guild.roles.cache.find(r=>r.name===ROLES.modo);
  if(!modoRole||!msg.member.roles.has(modoRole.id)){msg.reply("❌ Permission refusée").catch(()=>{});return;}
  const args=msg.content.split(" ");
  const userId=args[1]?.replace(/[<@!>]/g,"");
  if(!userId){msg.reply("Usage: `!validateqcm <@utilisateur>`").catch(()=>{});return;}
  try{
    const member=await msg.guild.members.fetch(userId);
    const role=msg.guild.roles.cache.find(r=>r.name===ROLES.member);
    if(role)await member.roles.add(role);
    db.qcmMembers.push({name:member.user.tag,date:new Date().toLocaleString("fr-FR")});
    db.members[userId]={...db.members[userId],qcmPassed:true};
    saveData();
    msg.reply(`✅ ${member.user.tag} validé !`).catch(()=>{});
    await notifyOwner(`✅ **QCM validé manuellement** — ${member.user.tag} par ${msg.author.tag}`);
  }catch(e){msg.reply("❌ Membre introuvable").catch(()=>{});}
});

client.login(TOKEN);
