require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) { console.error('Brak TOKEN, CLIENT_ID lub GUILD_ID w .env'); process.exit(1); }

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'grom-data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let data = { nextNumber: 1, members: {}, settings: { logChannelId: null } };
if (fs.existsSync(DATA_FILE)) { try { data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {} }
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// Stopnie poniżej są używane na serwerze RP. Nie stanowią odwzorowania obsady stanowisk JW GROM.
const RANKS = [
  'Szeregowy',
  'Starszy szeregowy',
  'Starszy szeregowy specjalista',
  'Kapral',
  'Starszy kapral',
  'Plutonowy',
  'Sierżant',
  'Starszy sierżant',
  'Młodszy chorąży',
  'Chorąży',
  'Starszy chorąży',
  'Podporucznik',
  'Porucznik',
  'Kapitan',
  'Major',
  'Podpułkownik',
  'Pułkownik',
  'Generał brygady',
  'Generał dywizji',
  'Generał broni',
  'Generał'
];

const SPECIAL_ROLES = ['Kandydat GROM','Rekrut','Operator GROM','Instruktor','Kadra Dowódcza','Emerytowany Operator','Urlopowany'];
const ADMIN_ROLES = ['Właściciel','Zarząd','Administrator','Moderator'];
const ALL_ROLES = [...ADMIN_ROLES, ...RANKS, ...SPECIAL_ROLES];
const CATEGORIES = {
  info: '🇵🇱 INFORMACJE GROM',
  command: '🎖️ DOWÓDZTWO',
  service: '🛡️ SŁUŻBA',
  records: '📁 KADRY I DOKUMENTACJA',
  training: '🎯 SZKOLENIA',
  communication: '📻 ŁĄCZNOŚĆ',
  logs: '📋 LOGI SYSTEMOWE'
};
const CHANNELS = {
  info: ['📢・komunikaty','📜・regulamin','ℹ️・informacje','📅・ważne-daty'],
  command: ['📣・rozkazy','🎖️・dowództwo','🗂️・decyzje-kadry'],
  service: ['🛡️・służba','📊・grafik','📝・raporty','🚨・meldunki'],
  records: ['👤・kadra','📁・dokumentacja','🆔・numery-grom'],
  training: ['🎯・szkolenia','📚・materiały-szkoleniowe','🏆・wyniki-szkoleń'],
  communication: ['📻・łączność','💬・rozmowy-kadry'],
  logs: ['📋・logi-kadrowe','🔐・logi-administracyjne']
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const commands = [
  new SlashCommandBuilder().setName('grom-setup').setDescription('Tworzy role i podstawową strukturę serwera GROM').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('grom-id').setDescription('Nadaje numer ewidencyjny GROM').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-awans').setDescription('Nadaje wyższy stopień RP').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-degradacja').setDescription('Nadaje niższy stopień RP').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-stopien').setDescription('Ustawia stopień RP').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)).addStringOption(o => o.setName('stopien').setDescription('Stopień').setRequired(true).addChoices(...RANKS.map(r => ({ name: r, value: r })))),
  new SlashCommandBuilder().setName('grom-info').setDescription('Pokazuje kartę funkcjonariusza').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-logi').setDescription('Ustawia kanał logów kadrowych').addChannelOption(o => o.setName('kanal').setDescription('Kanał tekstowy').setRequired(true).addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('grom-struktura').setDescription('Pokazuje hierarchię stopni RP'),
  new SlashCommandBuilder().setName('grom-panel').setDescription('Pokazuje centrum jednostki').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

function isStaff(member) { return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator); }
function rankIndex(rank) { return RANKS.indexOf(rank); }
function ensureMember(userId) { if (!data.members[userId]) data.members[userId] = { rank: 'Szeregowy', number: null, joinedAt: null, history: [] }; return data.members[userId]; }
async function syncRank(member, rank) {
  const role = member.guild.roles.cache.find(r => r.name === rank);
  if (!role) return false;
  for (const old of RANKS) { const r = member.guild.roles.cache.find(x => x.name === old); if (r && member.roles.cache.has(r.id) && r.id !== role.id) await member.roles.remove(r).catch(() => {}); }
  await member.roles.add(role).catch(() => {}); return true;
}
async function logAction(guild, title, description) {
  const ch = data.settings.logChannelId ? guild.channels.cache.get(data.settings.logChannelId) : null;
  if (!ch || !ch.isTextBased()) return;
  await ch.send({ embeds: [new EmbedBuilder().setTitle(`🛡️ GROM • ${title}`).setDescription(description).setTimestamp().setFooter({ text: 'GROM • System kadrowy RP' })] }).catch(() => {});
}

async function setupServer(guild) {
  const roleMap = {};
  for (let i = 0; i < ALL_ROLES.length; i++) {
    const name = ALL_ROLES[i];
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) role = await guild.roles.create({ name, reason: 'GROM RP – automatyczna konfiguracja' }).catch(() => null);
    if (role) roleMap[name] = role;
  }
  const categoryMap = {};
  for (const name of Object.values(CATEGORIES)) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
    if (!cat) cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'GROM RP – automatyczna konfiguracja' }).catch(() => null);
    if (cat) categoryMap[name] = cat;
  }
  const channelCategory = { info:'info', command:'command', service:'service', records:'records', training:'training', communication:'communication', logs:'logs' };
  for (const [key, names] of Object.entries(CHANNELS)) {
    const parent = categoryMap[CATEGORIES[channelCategory[key]]];
    for (const name of names) {
      if (!guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === name)) await guild.channels.create({ name, type: ChannelType.GuildText, parent: parent?.id, reason: 'GROM RP – automatyczna konfiguracja' }).catch(() => {});
    }
  }
  const logChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === '📋・logi-kadrowe');
  if (logChannel) data.settings.logChannelId = logChannel.id;
  save();
  return roleMap;
}

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`GROM bot zalogowany jako ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const guild = interaction.guild;

  if (interaction.commandName === 'grom-setup') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const roles = await setupServer(guild);
    return interaction.editReply(`✅ Konfiguracja GROM zakończona. Utworzono/sprawdzono **${Object.keys(roles).length} ról**, kategorie, kanały kadrowe i kanał logów.`);
  }

  if (interaction.commandName === 'grom-id') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    const user = interaction.options.getUser('osoba'); const record = ensureMember(user.id);
    if (!record.number) record.number = `GROM-${String(data.nextNumber++).padStart(3, '0')}`;
    if (!record.joinedAt) record.joinedAt = new Date().toISOString(); save();
    await interaction.reply(`🆔 ${user} otrzymuje numer **${record.number}**.`);
    await logAction(guild, 'Nadano numer', `**${user.tag}** → **${record.number}** przez ${interaction.user}.`); return;
  }

  if (interaction.commandName === 'grom-stopien' || interaction.commandName === 'grom-awans' || interaction.commandName === 'grom-degradacja') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    const user = interaction.options.getUser('osoba'); const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Osoba nie jest na serwerze.', ephemeral: true });
    const record = ensureMember(user.id); const old = record.rank; let newRank;
    if (interaction.commandName === 'grom-stopien') newRank = interaction.options.getString('stopien');
    else { const current = rankIndex(record.rank); const delta = interaction.commandName === 'grom-awans' ? 1 : -1; const next = Math.max(0, Math.min(RANKS.length - 1, current + delta)); if (next === current) return interaction.reply({ content: `ℹ️ Nie można wykonać operacji dla stopnia **${record.rank}**.`, ephemeral: true }); newRank = RANKS[next]; }
    record.rank = newRank; record.history.push({ type: interaction.commandName, from: old, to: newRank, by: interaction.user.id, at: new Date().toISOString() }); save();
    const synced = await syncRank(member, newRank);
    await interaction.reply(`🎖️ ${user}: **${old}** → **${newRank}**${synced ? '.' : '. Utwórz rolę o identycznej nazwie, aby bot mógł ją nadać.'}`);
    await logAction(guild, interaction.commandName === 'grom-awans' ? 'Awans' : interaction.commandName === 'grom-degradacja' ? 'Degradacja' : 'Zmiana stopnia', `**${user.tag}**: ${old} → **${newRank}** przez ${interaction.user}.`); return;
  }

  if (interaction.commandName === 'grom-info') {
    const user = interaction.options.getUser('osoba'); const record = data.members[user.id];
    if (!record) return interaction.reply({ content: '❌ Brak karty tej osoby.', ephemeral: true });
    const embed = new EmbedBuilder().setTitle('🛡️ Karta funkcjonariusza GROM').addFields(
      { name: 'Osoba', value: `${user}` }, { name: 'Numer', value: record.number || 'Nie nadano' }, { name: 'Stopień', value: record.rank || 'Nieustalony' },
      { name: 'Data przyjęcia', value: record.joinedAt ? `<t:${Math.floor(new Date(record.joinedAt).getTime()/1000)}:d>` : 'Nieustalona' }, { name: 'Historia', value: `${record.history?.length || 0} zmian` }
    ).setFooter({ text: 'GROM • System kadrowy RP' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'grom-logi') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    const channel = interaction.options.getChannel('kanal'); data.settings.logChannelId = channel.id; save(); return interaction.reply(`✅ Kanał logów ustawiony na ${channel}.`);
  }

  if (interaction.commandName === 'grom-struktura') {
    const half = Math.ceil(RANKS.length / 2);
    const enlisted = RANKS.slice(0, 3).map((r,i) => `**${i+1}.** ${r}`).join('\n');
    const ncos = RANKS.slice(3, 11).map((r,i) => `**${i+4}.** ${r}`).join('\n');
    const officers = RANKS.slice(11).map((r,i) => `**${i+12}.** ${r}`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎖️ Hierarchia stopni GROM • RP').setDescription('**Korpus szeregowych**\n' + enlisted + '\n\n**Korpus podoficerów i chorążych**\n' + ncos + '\n\n**Korpus oficerów**\n' + officers).addFields({ name: 'Role funkcyjne', value: SPECIAL_ROLES.join(' • ') }).setFooter({ text: 'Nazewnictwo stopni użyte na serwerze RP.' })] });
  }

  if (interaction.commandName === 'grom-panel') {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🇵🇱 GROM • Centrum Jednostki').setDescription('System kadrowy, stopnie, numery ewidencyjne i logi. **Podania i egzamin są obsługiwane przez osobne boty.**').addFields({ name: 'Komendy', value: '`/grom-setup` • `/grom-id` • `/grom-awans` • `/grom-degradacja` • `/grom-stopien` • `/grom-info` • `/grom-logi` • `/grom-struktura`' }).setFooter({ text: 'GROM • System kadrowy RP' })] });
  }
});

client.login(TOKEN);
