require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Brak TOKEN, CLIENT_ID lub GUILD_ID.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'grom-data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_DATA = {
  nextNumber: 1,
  members: {},
  settings: { logChannelId: null }
};

let data = DEFAULT_DATA;
if (fs.existsSync(DATA_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data = {
      ...DEFAULT_DATA,
      ...saved,
      settings: { ...DEFAULT_DATA.settings, ...(saved.settings || {}) }
    };
  } catch (error) {
    console.error('⚠️ Błąd odczytu danych:', error.message);
  }
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Stopnie używane na serwerze GROM RP.
// Bot NIE tworzy tych ról. Muszą istnieć wcześniej na Discordzie.
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const commands = [
  new SlashCommandBuilder()
    .setName('grom-id')
    .setDescription('Nadaje numer ewidencyjny GROM')
    .addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),

  new SlashCommandBuilder()
    .setName('grom-awans')
    .setDescription('Awansuje funkcjonariusza o jeden stopień')
    .addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),

  new SlashCommandBuilder()
    .setName('grom-degradacja')
    .setDescription('Degraduje funkcjonariusza o jeden stopień')
    .addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),

  new SlashCommandBuilder()
    .setName('grom-stopien')
    .setDescription('Ustawia konkretny stopień funkcjonariusza')
    .addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true))
    .addStringOption(o => o
      .setName('stopien')
      .setDescription('Nowy stopień')
      .setRequired(true)
      .addChoices(...RANKS.map(rank => ({ name: rank, value: rank })))),

  new SlashCommandBuilder()
    .setName('grom-info')
    .setDescription('Pokazuje kartę funkcjonariusza')
    .addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),

  new SlashCommandBuilder()
    .setName('grom-logi')
    .setDescription('Ustawia istniejący kanał logów')
    .addChannelOption(o => o
      .setName('kanal')
      .setDescription('Istniejący kanał tekstowy')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('grom-struktura')
    .setDescription('Pokazuje hierarchię stopni GROM RP')
].map(command => command.toJSON());

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.Administrator);
}

function ensureMember(userId) {
  if (!data.members[userId]) {
    data.members[userId] = {
      number: null,
      rank: 'Szeregowy',
      joinedAt: null,
      history: []
    };
  }
  return data.members[userId];
}

function rankIndex(rank) {
  return RANKS.indexOf(rank);
}

function findRankRole(guild, rank) {
  return guild.roles.cache.find(role => role.name === rank);
}

async function syncRank(member, rank) {
  const targetRole = findRankRole(member.guild, rank);

  // Nigdy nie twórz roli automatycznie.
  if (!targetRole) return false;

  for (const oldRank of RANKS) {
    const oldRole = findRankRole(member.guild, oldRank);
    if (oldRole && oldRole.id !== targetRole.id && member.roles.cache.has(oldRole.id)) {
      await member.roles.remove(oldRole).catch(() => {});
    }
  }

  await member.roles.add(targetRole).catch(() => {});
  return true;
}

async function logAction(guild, title, description) {
  if (!data.settings.logChannelId) return;

  const channel = guild.channels.cache.get(data.settings.logChannelId);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ GROM • ${title}`)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: 'GROM • System kadrowy RP' });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

client.once('clientReady', async readyClient => {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log(`✅ ${readyClient.user.tag} online`);
    console.log('✅ Komendy GROM zarejestrowane.');
    console.log('ℹ️ Ten bot NIE tworzy ról, kanałów, kategorii ani ticketów.');
    console.log('ℹ️ Podania i egzamin są obsługiwane przez osobne boty.');
  } catch (error) {
    console.error('❌ Błąd rejestracji komend:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const guild = interaction.guild;

  if (interaction.commandName === 'grom-id') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    }

    const user = interaction.options.getUser('osoba');
    const record = ensureMember(user.id);

    if (!record.number) {
      record.number = `GROM-${String(data.nextNumber).padStart(3, '0')}`;
      data.nextNumber++;
      record.joinedAt = record.joinedAt || new Date().toISOString();
      save();
    }

    await interaction.reply(`🆔 ${user} posiada numer **${record.number}**.`);
    await logAction(guild, 'Nadano numer', `**${user.tag}** → **${record.number}**. Nadał: ${interaction.user}.`);
    return;
  }

  if (interaction.commandName === 'grom-stopien') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    }

    const user = interaction.options.getUser('osoba');
    const newRank = interaction.options.getString('stopien');
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: '❌ Osoba nie znajduje się na serwerze.', ephemeral: true });
    }

    const record = ensureMember(user.id);
    const oldRank = record.rank;
    record.rank = newRank;
    record.history.push({
      type: 'zmiana-stopnia',
      from: oldRank,
      to: newRank,
      by: interaction.user.id,
      at: new Date().toISOString()
    });
    save();

    const synced = await syncRank(member, newRank);
    const message = synced
      ? `🎖️ ${user}: **${oldRank}** → **${newRank}**. Rola została zsynchronizowana.`
      : `🎖️ ${user}: **${oldRank}** → **${newRank}**. ⚠️ Rola **${newRank}** nie istnieje — bot jej nie utworzy.`;

    await interaction.reply(message);
    await logAction(guild, 'Zmiana stopnia', `**${user.tag}**: ${oldRank} → **${newRank}**. Wykonał: ${interaction.user}.`);
    return;
  }

  if (interaction.commandName === 'grom-awans' || interaction.commandName === 'grom-degradacja') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    }

    const user = interaction.options.getUser('osoba');
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: '❌ Osoba nie znajduje się na serwerze.', ephemeral: true });
    }

    const record = ensureMember(user.id);
    const current = rankIndex(record.rank);
    const direction = interaction.commandName === 'grom-awans' ? 1 : -1;
    const next = current + direction;

    if (next < 0 || next >= RANKS.length) {
      return interaction.reply({ content: `ℹ️ Nie można wykonać operacji dla stopnia **${record.rank}**.`, ephemeral: true });
    }

    const oldRank = record.rank;
    const newRank = RANKS[next];
    record.rank = newRank;
    record.history.push({
      type: interaction.commandName,
      from: oldRank,
      to: newRank,
      by: interaction.user.id,
      at: new Date().toISOString()
    });
    save();

    const synced = await syncRank(member, newRank);
    const action = interaction.commandName === 'grom-awans' ? 'Awans' : 'Degradacja';
    const roleMessage = synced
      ? ' Rola została zsynchronizowana.'
      : ' ⚠️ Brak odpowiedniej roli — bot jej nie utworzy.';

    await interaction.reply(`🎖️ **${action}** ${user}: **${oldRank}** → **${newRank}**.${roleMessage}`);
    await logAction(guild, action, `**${user.tag}**: ${oldRank} → **${newRank}**. Wykonał: ${interaction.user}.`);
    return;
  }

  if (interaction.commandName === 'grom-info') {
    const user = interaction.options.getUser('osoba');
    const record = data.members[user.id];

    if (!record) {
      return interaction.reply({ content: '❌ Brak karty tej osoby.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Karta funkcjonariusza GROM')
      .addFields(
        { name: '👤 Osoba', value: `${user}`, inline: true },
        { name: '🆔 Numer', value: record.number || 'Nie nadano', inline: true },
        { name: '🎖️ Stopień', value: record.rank || 'Nieustalony', inline: true },
        {
          name: '📅 Data przyjęcia',
          value: record.joinedAt ? `<t:${Math.floor(new Date(record.joinedAt).getTime() / 1000)}:d>` : 'Nieustalona',
          inline: true
        },
        { name: '📋 Historia zmian', value: String(record.history?.length || 0), inline: true }
      )
      .setFooter({ text: 'GROM • System kadrowy RP' });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'grom-logi') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('kanal');
    data.settings.logChannelId = channel.id;
    save();

    await interaction.reply(`✅ Ustawiono istniejący kanał logów: ${channel}. Bot nie utworzył kanału.`);
    await logAction(guild, 'Konfiguracja logów', `Kanał logów ustawiony przez ${interaction.user}: ${channel}.`);
    return;
  }

  if (interaction.commandName === 'grom-struktura') {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🎖️ Hierarchia GROM • RP')
        .setDescription(RANKS.map((rank, index) => `**${index + 1}.** ${rank}`).join('\n'))
        .setFooter({ text: 'Bot nie tworzy tych ról automatycznie.' })]
    });
  }
});

client.login(TOKEN).catch(error => {
  console.error('❌ Nie udało się zalogować bota:', error.message);
  process.exit(1);
});
