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

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Brak TOKEN, CLIENT_ID lub GUILD_ID w .env');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'grom-data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let data = { nextNumber: 1, applications: {}, exams: {} };
if (fs.existsSync(DATA_FILE)) {
  try { data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}
}
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
  new SlashCommandBuilder().setName('grom-id').setDescription('Nadaje kandydatowi numer GROM').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('podanie').setDescription('Rozpoczyna proces podania do GROM'),
  new SlashCommandBuilder().setName('egzamin').setDescription('Rozpoczyna egzamin rekrutacyjny GROM'),
  new SlashCommandBuilder().setName('egzamin-wynik').setDescription('Pokazuje wynik egzaminu').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-info').setDescription('Pokazuje informacje o kandydacie').addUserOption(o => o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-panel').setDescription('Tworzy podstawowy panel rekrutacyjny').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

const questions = [
  { q: 'Jaki jest podstawowy cel procesu rekrutacyjnego w RP?', a: ['Ocena kandydata', 'Automatyczne przyjęcie każdego', 'Zdobycie pieniędzy'], correct: 0 },
  { q: 'Co powinien zrobić kandydat przed rozpoczęciem służby?', a: ['Zapoznać się z regulaminem', 'Ominąć egzamin', 'Usunąć podanie'], correct: 0 },
  { q: 'Jak należy zachować się podczas służby RP?', a: ['Profesjonalnie i zgodnie z zasadami serwera', 'Losowo', 'Ignorować polecenia kadry'], correct: 0 },
  { q: 'Co oznacza RP?', a: ['Roleplay', 'Random Player', 'Real Police'], correct: 0 },
  { q: 'Czy wynik egzaminu powinien być zapisany?', a: ['Tak', 'Nie', 'Tylko po niezdanym'], correct: 0 }
];

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`GROM bot zalogowany jako ${client.user.tag}`);
});

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'grom-id') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    const user = interaction.options.getUser('osoba');
    const id = `GROM-${String(data.nextNumber++).padStart(3, '0')}`;
    data.applications[user.id] = { ...(data.applications[user.id] || {}), id, userId: user.id, createdAt: new Date().toISOString() };
    save();
    return interaction.reply(`🆔 Nadano **${id}** dla ${user}.`);
  }

  if (interaction.commandName === 'podanie') {
    data.applications[interaction.user.id] = { ...(data.applications[interaction.user.id] || {}), status: 'oczekuje', submittedAt: new Date().toISOString() };
    save();
    return interaction.reply({ content: '📋 Twoje podanie do GROM zostało zarejestrowane. Następny etap: **egzamin rekrutacyjny**.', ephemeral: true });
  }

  if (interaction.commandName === 'egzamin') {
    data.exams[interaction.user.id] = { startedAt: new Date().toISOString(), questions: questions.length, correct: 0, completed: false };
    save();
    const embed = new EmbedBuilder().setTitle('🎖️ Egzamin rekrutacyjny GROM').setDescription(`Egzamin zawiera **${questions.length} pytań**. Wersja podstawowa systemu jest przygotowana do dalszej rozbudowy o przyciski i formularze odpowiedzi.`).addFields({ name: 'Status', value: 'Rozpoczęty' }).setFooter({ text: 'GROM • System rekrutacyjny RP' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'egzamin-wynik') {
    const user = interaction.options.getUser('osoba');
    const exam = data.exams[user.id];
    if (!exam) return interaction.reply({ content: '❌ Brak zapisanego egzaminu.', ephemeral: true });
    const percent = exam.questions ? Math.round((exam.correct / exam.questions) * 100) : 0;
    return interaction.reply({ content: `📊 **${user.tag}** — wynik: **${exam.correct}/${exam.questions} (${percent}%)**.`, ephemeral: !isStaff(interaction.member) && user.id !== interaction.user.id });
  }

  if (interaction.commandName === 'grom-info') {
    const user = interaction.options.getUser('osoba');
    const record = data.applications[user.id];
    if (!record) return interaction.reply({ content: '❌ Brak danych tej osoby.', ephemeral: true });
    const exam = data.exams[user.id];
    const embed = new EmbedBuilder().setTitle('🛡️ Karta GROM').addFields(
      { name: 'Osoba', value: `${user}` },
      { name: 'Numer', value: record.id || 'Nie nadano' },
      { name: 'Podanie', value: record.status || 'Nie złożono' },
      { name: 'Egzamin', value: exam ? `${exam.correct}/${exam.questions}` : 'Nie rozpoczęto' }
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'grom-panel') {
    const embed = new EmbedBuilder().setTitle('🇵🇱 GROM • Rekrutacja RP').setDescription('Aby rozpocząć rekrutację, użyj `/podanie`. Po zarejestrowaniu podania kandydat przechodzi do egzaminu `/egzamin`.').setFooter({ text: 'GROM • System rekrutacyjny' });
    return interaction.reply({ embeds: [embed] });
  }
});

client.login(TOKEN);
