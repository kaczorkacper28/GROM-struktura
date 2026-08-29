require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ChannelType, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionsBitField
} = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Brak TOKEN, CLIENT_ID lub GUILD_ID w .env');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'grom-data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let data = { nextNumber: 1, members: {}, settings: { logChannelId: null } };
if (fs.existsSync(DATA_FILE)) {
  try { data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}
}
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// Stopnie używane na serwerze RP. Nie są oficjalnym odwzorowaniem stanowisk JW GROM.
const RANKS = [
  'Szeregowy', 'Starszy szeregowy', 'Starszy szeregowy specjalista',
  'Kapral', 'Starszy kapral', 'Plutonowy', 'Sierżant', 'Starszy sierżant',
  'Młodszy chorąży', 'Chorąży', 'Starszy chorąży', 'Podporucznik',
  'Porucznik', 'Kapitan', 'Major', 'Podpułkownik', 'Pułkownik',
  'Generał brygady', 'Generał dywizji', 'Generał broni', 'Generał'
];

const CITIZEN_ROLE = 'Obywatel';
const GROM_ROLE = 'GROM';
const SPECIAL_ROLES = ['Kandydat GROM', 'Rekrut', 'Operator GROM', 'Instruktor', 'Kadra Dowódcza', 'Emerytowany Operator', 'Urlopowany'];
const ADMIN_ROLES = ['Właściciel', 'Zarząd', 'Administrator', 'Moderator'];
const GROM_ACCESS_ROLES = [GROM_ROLE, ...RANKS, ...SPECIAL_ROLES];
const ALL_ROLES = [...ADMIN_ROLES, CITIZEN_ROLE, GROM_ROLE, ...RANKS, ...SPECIAL_ROLES];

const CATEGORIES = {
  citizen: '🇵🇱 STREFA OBYWATELA',
  command: '🎖️ DOWÓDZTWO GROM',
  service: '🛡️ SŁUŻBA GROM',
  records: '📁 KADRY I DOKUMENTACJA GROM',
  training: '🎯 SZKOLENIA GROM',
  communication: '📻 ŁĄCZNOŚĆ GROM',
  logs: '📋 LOGI SYSTEMOWE GROM',
  tickets: '🎫 TICKETY GROM'
};

const CHANNELS = {
  citizen: ['📢・komunikaty', '📜・regulamin', 'ℹ️・informacje-dla-obywateli', '🎫・centrum-ticketów'],
  command: ['📣・rozkazy', '🎖️・dowództwo', '🗂️・decyzje-kadry'],
  service: ['🛡️・służba', '📊・grafik', '📝・raporty', '🚨・meldunki'],
  records: ['👤・kadra', '📁・dokumentacja', '🆔・numery-grom'],
  training: ['🎯・szkolenia', '📚・materiały-szkoleniowe', '🏆・wyniki-szkoleń'],
  communication: ['📻・łączność', '💬・rozmowy-kadry'],
  logs: ['📋・logi-kadrowe', '🔐・logi-administracyjne']
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
  new SlashCommandBuilder().setName('grom-setup').setDescription('Tworzy role, kanały i zabezpieczenia widoczności').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('grom-id').setDescription('Nadaje numer ewidencyjny GROM').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-awans').setDescription('Nadaje wyższy stopień RP').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-degradacja').setDescription('Nadaje niższy stopień RP').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-stopien').setDescription('Ustawia stopień RP').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)).addStringOption(o => o.setName('stopien').setDescription('Stopień').setRequired(true).addChoices(...RANKS.map(r => ({ name: r, value: r })))),
  new SlashCommandBuilder().setName('grom-info').setDescription('Pokazuje kartę funkcjonariusza').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-logi').setDescription('Ustawia kanał logów kadrowych').addChannelOption(o => o.setName('kanal').setDescription('Kanał tekstowy').setRequired(true).addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('grom-struktura').setDescription('Pokazuje hierarchię stopni RP'),
  new SlashCommandBuilder().setName('grom-panel').setDescription('Pokazuje centrum jednostki').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('grom-ticket-panel').setDescription('Wysyła panel ticketów dla obywateli').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator);
}
function rankIndex(rank) { return RANKS.indexOf(rank); }
function ensureMember(userId) {
  if (!data.members[userId]) data.members[userId] = { rank: 'Szeregowy', number: null, joinedAt: null, history: [] };
  return data.members[userId];
}

function findRole(guild, name) { return guild.roles.cache.find(r => r.name === name); }
function getAccessRoles(guild) {
  return [...GROM_ACCESS_ROLES, ...ADMIN_ROLES].map(name => findRole(guild, name)).filter(Boolean);
}

async function syncRank(member, rank) {
  const role = findRole(member.guild, rank);
  if (!role) return false;
  for (const old of RANKS) {
    const r = findRole(member.guild, old);
    if (r && member.roles.cache.has(r.id) && r.id !== role.id) await member.roles.remove(r).catch(() => {});
  }
  await member.roles.add(role).catch(() => {});
  const gromRole = findRole(member.guild, GROM_ROLE);
  const citizenRole = findRole(member.guild, CITIZEN_ROLE);
  if (gromRole) await member.roles.add(gromRole).catch(() => {});
  if (citizenRole) await member.roles.remove(citizenRole).catch(() => {});
  return true;
}

async function logAction(guild, title, description) {
  const ch = data.settings.logChannelId ? guild.channels.cache.get(data.settings.logChannelId) : null;
  if (!ch || !ch.isTextBased()) return;
  await ch.send({ embeds: [new EmbedBuilder()
    .setTitle(`🛡️ GROM • ${title}`)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: 'GROM • System kadrowy RP' })] }).catch(() => {});
}

async function createRole(guild, name, color) {
  let role = findRole(guild, name);
  if (!role) role = await guild.roles.create({ name, color, reason: 'GROM RP – automatyczna konfiguracja' }).catch(() => null);
  return role;
}

function permissionOverwritesForCitizen(guild) {
  const everyone = guild.roles.everyone;
  const citizen = findRole(guild, CITIZEN_ROLE);
  const overwrites = [{ id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
  if (citizen) overwrites.push({ id: citizen.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  for (const role of ADMIN_ROLES.map(n => findRole(guild, n)).filter(Boolean)) {
    overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  return overwrites;
}

function permissionOverwritesForGrom(guild) {
  const everyone = guild.roles.everyone;
  const overwrites = [{ id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
  for (const role of getAccessRoles(guild)) {
    overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  return overwrites;
}

function permissionOverwritesForTickets(guild) {
  const everyone = guild.roles.everyone;
  const overwrites = [{ id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
  for (const role of getAccessRoles(guild)) {
    overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  return overwrites;
}

async function setupServer(guild) {
  const roleMap = {};
  for (const name of ALL_ROLES) {
    const role = await createRole(guild, name);
    if (role) roleMap[name] = role;
  }

  const categoryMap = {};
  for (const [key, name] of Object.entries(CATEGORIES)) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
    const overwrites = key === 'citizen' ? permissionOverwritesForCitizen(guild)
      : key === 'tickets' ? permissionOverwritesForTickets(guild)
      : permissionOverwritesForGrom(guild);
    if (!cat) {
      cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: 'GROM RP – automatyczna konfiguracja' }).catch(() => null);
    } else {
      await cat.permissionOverwrites.set(overwrites).catch(() => {});
    }
    if (cat) categoryMap[key] = cat;
  }

  for (const [key, names] of Object.entries(CHANNELS)) {
    const parent = categoryMap[key];
    for (const name of names) {
      let channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === name);
      const overwrites = key === 'citizen' ? permissionOverwritesForCitizen(guild) : permissionOverwritesForGrom(guild);
      if (!channel) {
        channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parent?.id, permissionOverwrites: overwrites, reason: 'GROM RP – automatyczna konfiguracja' }).catch(() => null);
      } else {
        if (parent && channel.parentId !== parent.id) await channel.setParent(parent.id).catch(() => {});
        await channel.permissionOverwrites.set(overwrites).catch(() => {});
      }
    }
  }

  const logChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === '📋・logi-kadrowe');
  if (logChannel) data.settings.logChannelId = logChannel.id;
  save();
  return roleMap;
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🎫 GROM • CENTRUM OBSŁUGI OBYWATELA')
    .setDescription('Potrzebujesz pomocy lub chcesz zgłosić sprawę w ramach RP?\n\nKliknij odpowiedni przycisk. Po utworzeniu ticketu dostęp otrzymasz Ty oraz członkowie GROM.')
    .addFields(
      { name: '🆘 Pomoc', value: 'Pytanie, problem lub pomoc na serwerze.', inline: true },
      { name: '📋 Sprawa RP', value: 'Zgłoszenie dotyczące sytuacji RP.', inline: true },
      { name: '⚠️ Zgłoszenie', value: 'Zgłoszenie naruszenia zasad lub zachowania.', inline: true }
    )
    .setFooter({ text: 'GROM • Centrum Ticketów RP' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_pomoc').setLabel('Pomoc').setEmoji('🆘').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_rp').setLabel('Sprawa RP').setEmoji('📋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_zgloszenie').setLabel('Zgłoszenie').setEmoji('⚠️').setStyle(ButtonStyle.Danger)
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const ticketsCategory = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === CATEGORIES.tickets);
  if (!ticketsCategory) return interaction.reply({ content: '❌ Brak kategorii ticketów. Administrator musi uruchomić `/grom-setup`.', ephemeral: true });

  const existing = guild.channels.cache.find(c => c.parentId === ticketsCategory.id && c.topic === `ticket:${interaction.user.id}`);
  if (existing) return interaction.reply({ content: `❌ Masz już otwarty ticket: ${existing}`, ephemeral: true });

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 18) || 'obywatel';
  const typeNames = { pomoc: 'pomoc', rp: 'sprawa-rp', zgloszenie: 'zgloszenie' };
  const channel = await guild.channels.create({
    name: `ticket-${typeNames[type]}-${safeName}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: ticketsCategory.id,
    topic: `ticket:${interaction.user.id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ...getAccessRoles(guild).map(role => ({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }))
    ],
    reason: `GROM RP – ticket ${type}`
  }).catch(() => null);

  if (!channel) return interaction.reply({ content: '❌ Nie udało się utworzyć ticketu. Sprawdź uprawnienia bota.', ephemeral: true });

  const typeLabel = typeNames[type];
  const embed = new EmbedBuilder()
    .setTitle(`🎫 Ticket GROM • ${typeLabel}`)
    .setDescription(`Witaj ${interaction.user}!\n\nOpisz dokładnie swoją sprawę. Członek GROM odpowie, gdy będzie dostępny.`)
    .addFields({ name: '👤 Obywatel', value: `${interaction.user}`, inline: true }, { name: '📌 Typ', value: typeLabel, inline: true })
    .setFooter({ text: 'GROM • Ticket RP' });
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Zamknij ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [closeRow] });
  await interaction.reply({ content: `✅ Utworzono ticket: ${channel}`, ephemeral: true });
  await logAction(guild, 'Utworzono ticket', `**${interaction.user.tag}** utworzył ticket **${channel.name}** (${typeLabel}).`);
}

client.once('clientReady', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`GROM bot zalogowany jako ${client.user.tag}`);
});

client.on('guildMemberAdd', async member => {
  const citizen = findRole(member.guild, CITIZEN_ROLE);
  const grom = findRole(member.guild, GROM_ROLE);
  const isKnownGrom = data.members[member.id]?.number;
  if (citizen && !isKnownGrom) await member.roles.add(citizen).catch(() => {});
  if (grom && isKnownGrom) await member.roles.add(grom).catch(() => {});
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('ticket_') && interaction.customId !== 'ticket_close') {
        const type = interaction.customId.replace('ticket_', '');
        return createTicket(interaction, type);
      }
      if (interaction.customId === 'ticket_close') {
        const member = interaction.member;
        const isGrom = GROM_ACCESS_ROLES.some(name => member.roles?.cache?.some(r => r.name === name)) || isStaff(member);
        if (!isGrom && interaction.channel?.topic !== `ticket:${interaction.user.id}`) {
          return interaction.reply({ content: '❌ Nie możesz zamknąć tego ticketu.', ephemeral: true });
        }
        await interaction.reply({ content: '🔒 Ticket zostanie zamknięty za 3 sekundy.' });
        await logAction(interaction.guild, 'Zamknięto ticket', `**${interaction.user.tag}** zamknął **${interaction.channel.name}**.`);
        setTimeout(() => interaction.channel?.delete('GROM RP – zamknięcie ticketu').catch(() => {}), 3000);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const guild = interaction.guild;

    if (interaction.commandName === 'grom-setup') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const roles = await setupServer(guild);
      return interaction.editReply(`✅ Konfiguracja zakończona. **${Object.keys(roles).length} ról** oraz strefy Obywatel/GROM zostały utworzone i zabezpieczone. Dodano również system ticketów.`);
    }

    if (interaction.commandName === 'grom-ticket-panel') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
      const channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === '🎫・centrum-ticketów');
      if (!channel) return interaction.reply({ content: '❌ Najpierw uruchom `/grom-setup`.', ephemeral: true });
      await sendTicketPanel(channel);
      return interaction.reply({ content: `✅ Panel ticketów wysłany na ${channel}.`, ephemeral: true });
    }

    if (interaction.commandName === 'grom-id') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
      const user = interaction.options.getUser('osoba'); const record = ensureMember(user.id);
      if (!record.number) record.number = `GROM-${String(data.nextNumber++).padStart(3, '0')}`;
      if (!record.joinedAt) record.joinedAt = new Date().toISOString();
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (member) await syncRank(member, record.rank || 'Szeregowy');
      save();
      await interaction.reply(`🆔 ${user} otrzymuje numer **${record.number}** i zostaje oznaczony jako GROM.`);
      await logAction(guild, 'Nadano numer', `**${user.tag}** → **${record.number}** przez ${interaction.user}.`);
      return;
    }

    if (interaction.commandName === 'grom-stopien' || interaction.commandName === 'grom-awans' || interaction.commandName === 'grom-degradacja') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
      const user = interaction.options.getUser('osoba'); const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Osoba nie jest na serwerze.', ephemeral: true });
      const record = ensureMember(user.id); const old = record.rank; let newRank;
      if (interaction.commandName === 'grom-stopien') newRank = interaction.options.getString('stopien');
      else {
        const current = rankIndex(record.rank); const delta = interaction.commandName === 'grom-awans' ? 1 : -1;
        const next = Math.max(0, Math.min(RANKS.length - 1, current + delta));
        if (next === current) return interaction.reply({ content: `ℹ️ Nie można wykonać operacji dla stopnia **${record.rank}**.`, ephemeral: true });
        newRank = RANKS[next];
      }
      record.rank = newRank;
      record.history.push({ type: interaction.commandName, from: old, to: newRank, by: interaction.user.id, at: new Date().toISOString() });
      save();
      const synced = await syncRank(member, newRank);
      await interaction.reply(`🎖️ ${user}: **${old}** → **${newRank}**${synced ? '.' : '. Brak roli stopnia – uruchom `/grom-setup`.'}`);
      await logAction(guild, interaction.commandName === 'grom-awans' ? 'Awans' : interaction.commandName === 'grom-degradacja' ? 'Degradacja' : 'Zmiana stopnia', `**${user.tag}**: ${old} → **${newRank}** przez ${interaction.user}.`);
      return;
    }

    if (interaction.commandName === 'grom-info') {
      const user = interaction.options.getUser('osoba'); const record = data.members[user.id];
      if (!record) return interaction.reply({ content: '❌ Brak karty tej osoby.', ephemeral: true });
      const embed = new EmbedBuilder().setTitle('🛡️ Karta funkcjonariusza GROM').addFields(
        { name: 'Osoba', value: `${user}` }, { name: 'Numer', value: record.number || 'Nie nadano' },
        { name: 'Stopień', value: record.rank || 'Nieustalony' },
        { name: 'Data przyjęcia', value: record.joinedAt ? `<t:${Math.floor(new Date(record.joinedAt).getTime()/1000)}:d>` : 'Nieustalona' },
        { name: 'Historia', value: `${record.history?.length || 0} zmian` }
      ).setFooter({ text: 'GROM • System kadrowy RP' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'grom-logi') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
      const channel = interaction.options.getChannel('kanal'); data.settings.logChannelId = channel.id; save();
      return interaction.reply(`✅ Kanał logów ustawiony na ${channel}.`);
    }

    if (interaction.commandName === 'grom-struktura') {
      const enlisted = RANKS.slice(0, 3).map((r,i) => `**${i+1}.** ${r}`).join('\n');
      const ncos = RANKS.slice(3, 11).map((r,i) => `**${i+4}.** ${r}`).join('\n');
      const officers = RANKS.slice(11).map((r,i) => `**${i+12}.** ${r}`).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎖️ Hierarchia stopni GROM • RP').setDescription('**Korpus szeregowych**\n' + enlisted + '\n\n**Korpus podoficerów i chorążych**\n' + ncos + '\n\n**Korpus oficerów**\n' + officers).addFields({ name: 'Role funkcyjne', value: SPECIAL_ROLES.join(' • ') }).setFooter({ text: 'Nazewnictwo stopni użyte na serwerze RP.' })] });
    }

    if (interaction.commandName === 'grom-panel') {
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🇵🇱 GROM • Centrum Jednostki').setDescription('System kadrowy, stopnie, numery ewidencyjne, logi i tickety. **Podania i egzamin są obsługiwane przez osobne boty.**').addFields({ name: 'Komendy', value: '`/grom-setup` • `/grom-id` • `/grom-awans` • `/grom-degradacja` • `/grom-stopien` • `/grom-info` • `/grom-logi` • `/grom-struktura` • `/grom-ticket-panel`' }).setFooter({ text: 'GROM • System kadrowy RP' })] });
    }
  } catch (error) {
    console.error('GROM interaction error:', error);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Wystąpił błąd. Spróbuj ponownie.', ephemeral: true }).catch(() => {});
    else if (interaction.deferred) await interaction.editReply({ content: '❌ Wystąpił błąd. Sprawdź logi Render.' }).catch(() => {});
  }
});

client.login(TOKEN);
