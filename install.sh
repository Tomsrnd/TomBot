#!/bin/bash
# ════════════════════════════════════════════════
#  TomBot — Script d'installation automatique
#  Compatible Ubuntu Server / Raspberry Pi
# ════════════════════════════════════════════════

set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════╗"
echo "║     TomBot — Installation auto       ║"
echo "║         Tom_O_Carre Discord          ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# ── Vérification root ──
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Lance ce script en root : sudo su - puis bash install.sh${NC}"
  exit 1
fi

# ── Variables ──
BOT_DIR="/root/TomBot"
NODE_VERSION="20"

echo -e "${YELLOW}📦 Étape 1 — Mise à jour du système...${NC}"
apt update -qq && apt upgrade -y -qq
apt install -y git curl wget nano -qq

echo -e "${YELLOW}📦 Étape 2 — Installation Node.js ${NODE_VERSION}...${NC}"
# Téléchargement direct pour ARM (Raspberry Pi 2)
ARCH=$(uname -m)
if [ "$ARCH" = "armv7l" ]; then
  echo "🍓 Architecture ARM détectée (Raspberry Pi)"
  wget -q https://nodejs.org/dist/v20.11.0/node-v20.11.0-linux-armv7l.tar.xz -O /tmp/node.tar.xz
  tar -xf /tmp/node.tar.xz -C /tmp/
  cp -r /tmp/node-v20.11.0-linux-armv7l/* /usr/local/
  rm /tmp/node.tar.xz
  ln -sf /usr/local/bin/node /usr/bin/node 2>/dev/null || true
  ln -sf /usr/local/bin/npm /usr/bin/npm 2>/dev/null || true
else
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - -qq
  apt install -y nodejs -qq
fi

echo "✅ Node.js : $(node --version)"
echo "✅ npm     : $(npm --version)"

echo -e "${YELLOW}📦 Étape 3 — Installation PM2...${NC}"
npm install -g pm2 -q
echo "✅ PM2 : $(pm2 --version)"

echo -e "${YELLOW}📁 Étape 4 — Création du dossier bot...${NC}"
mkdir -p $BOT_DIR
cd $BOT_DIR

echo -e "${YELLOW}📥 Étape 5 — Téléchargement des fichiers...${NC}"
# Si le repo GitHub est configuré
if [ -n "$GITHUB_REPO" ]; then
  git clone $GITHUB_REPO $BOT_DIR --quiet || git -C $BOT_DIR pull --quiet
else
  echo -e "${YELLOW}⚠️  Pas de repo GitHub — copie les fichiers manuellement dans $BOT_DIR${NC}"
fi

echo -e "${YELLOW}📦 Étape 6 — Installation des dépendances npm...${NC}"
cd $BOT_DIR
npm init -y -q
npm install discord.js -q
echo "✅ discord.js installé"

echo -e "${YELLOW}⚙️  Étape 7 — Configuration...${NC}"

# Demander les infos si .env n'existe pas
if [ ! -f "$BOT_DIR/.env" ]; then
  echo ""
  echo -e "${BLUE}🔧 Configuration du bot :${NC}"
  read -p "Token Discord              : " DISCORD_TOKEN
  read -p "ID du serveur Discord      : " GUILD_ID
  read -p "Ton ID utilisateur Discord : " OWNER_ID
  read -p "Pseudo Twitch (chaîne)     : " TWITCH_USERNAME
  read -p "Client ID Twitch           : " TWITCH_CLIENT_ID
  read -p "Client Secret Twitch       : " TWITCH_CLIENT_SECRET
  read -p "Pseudo bot Twitch          : " TWITCH_BOT_USERNAME
  read -p "Token OAuth bot Twitch     : " TWITCH_BOT_TOKEN

  cat > $BOT_DIR/.env << EOF
DISCORD_TOKEN=${DISCORD_TOKEN}
GUILD_ID=${GUILD_ID}
OWNER_ID=${OWNER_ID}
TWITCH_USERNAME=${TWITCH_USERNAME}
TWITCH_CLIENT_ID=${TWITCH_CLIENT_ID}
TWITCH_CLIENT_SECRET=${TWITCH_CLIENT_SECRET}
TWITCH_BOT_USERNAME=${TWITCH_BOT_USERNAME}
TWITCH_BOT_TOKEN=${TWITCH_BOT_TOKEN}
DASHBOARD_PORT=3000
EOF
  echo -e "${GREEN}✅ Fichier .env créé${NC}"
else
  echo -e "${GREEN}✅ Fichier .env déjà présent${NC}"
fi

# .gitignore
cat > $BOT_DIR/.gitignore << 'EOF'
.env
node_modules/
*.backup
data.json
EOF

echo -e "${YELLOW}🚀 Étape 8 — Démarrage du bot avec PM2...${NC}"
cd $BOT_DIR
pm2 delete tom-bot 2>/dev/null || true
pm2 start welcome-bot.js --name "tom-bot" --max-memory-restart 150M
pm2 save

echo -e "${YELLOW}🔄 Étape 9 — Démarrage automatique au reboot...${NC}"
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
pm2 save

echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════╗"
echo "║        ✅ Installation terminée !    ║"
echo "╠══════════════════════════════════════╣"
IP=$(hostname -I | awk '{print $1}')
echo "║  Dashboard : http://${IP}:3000"
echo "║"
echo "║  Commandes utiles :"
echo "║  pm2 status          → état du bot"
echo "║  pm2 logs tom-bot    → logs en direct"
echo "║  pm2 restart tom-bot → redémarrer"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"
