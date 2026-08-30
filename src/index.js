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
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Brak TOKEN, CLIENT_ID lub GUILD_ID.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'grom-data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_DATA = { nextNumber: 1, members: {}, tickets: {}, settings: { logChannelId: null } };
let data = DEFAULT_DATA;
if (fs.existsSync(DATA_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data = { ...DEFAULT_DATA, ...saved, settings: { ...DEFAULT_DATA.settings, ...(saved.settings || {}) }, members: saved.members || {}, tickets: saved.tickets || {} };
  } catch (error) { console.error('⚠️ Błąd odczytu danych:', error.message); }
}
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

const RANKS = [
  'Szeregowy','Starszy szeregowy','Starszy szeregowy specjalista','Kapral','Starszy kapral','Plutonowy','Sierżant','Starszy sierżant','Młodszy chorąży','Chorąży','Starszy chorąży','Podporucznik','Porucznik','Kapitan','Major','Podpułkownik','Pułkownik','Generał brygady','Generał dywizji','Generał broni','Generał'
];
const GROM_ACCESS_ROLES = ['Kandydat','Rekrut','Kadra GROM','Dowództwo GROM',...RANKS];

// Rekrutacja i egzamin są obsługiwane przez osobne boty.
const CITIZEN_TICKETS = {
  pomoc: { label:'🆘 Pomoc GROM', description:'Pomoc techniczna, organizacyjna lub pytania dotyczące serwera.' },
  kontakt: { label:'📞 Kontakt z GROM', description:'Bezpośredni kontakt w sprawie GROM RP.' },
  zgloszenie: { label:'🚨 Zgłoszenie', description:'Zgłoszenie ważnej sytuacji wymagającej reakcji GROM.' },
  skarga: { label:'⚖️ Skarga', description:'Skarga dotycząca funkcjonariusza lub sytuacji.' },
  pochwala: { label:'📨 Pochwała', description:'Pochwała lub pozytywna informacja o funkcjonariuszu.' },
  wniosek: { label:'📄 Wniosek do GROM', description:'Złożenie wniosku lub prośby do GROM.' },
  poufna: { label:'🔐 Sprawa poufna', description:'Sprawa wymagająca ograniczonego dostępu.' },
  wspolpraca: { label:'🤝 Współpraca', description:'Propozycja współpracy z GROM RP.' },
  firma: { label:'🏢 Współpraca z firmą', description:'Sprawy dotyczące współpracy z przedsiębiorstwem.' },
  spotkanie: { label:'📅 Spotkanie', description:'Prośba o kontakt lub umówienie spotkania.' },
  inne: { label:'💬 Inne', description:'Pozostałe sprawy, których nie obejmują inne kategorie.' }
};
const GROM_TICKETS = {
  kadry:{ label:'👤 Sprawa kadrowa',description:'Sprawy personalne funkcjonariuszy.' },
  awans:{ label:'📈 Wniosek o awans',description:'Wniosek dotyczący awansu.' },
  degradacja:{ label:'📉 Wniosek o degradację',description:'Wniosek dotyczący degradacji.' },
  urlop:{ label:'📆 Urlop',description:'Wniosek lub sprawa dotycząca urlopu.' },
  przeniesienie:{ label:'🔄 Przeniesienie',description:'Sprawa przeniesienia lub zmiany przydziału.' },
  sluzbowa:{ label:'📝 Sprawa służbowa',description:'Wewnętrzna sprawa służbowa.' },
  incydent:{ label:'🚨 Incydent służbowy',description:'Zgłoszenie incydentu wewnętrznego.' },
  odznaczenie:{ label:'🏅 Odznaczenie',description:'Wniosek dotyczący wyróżnienia lub odznaczenia.' },
  lacznosc:{ label:'📡 Problem z łącznością',description:'Problem dotyczący systemów łączności.' },
  poufna_grom:{ label:'🔒 Sprawa poufna GROM',description:'Wewnętrzna sprawa o ograniczonym dostępie.' },
  dowodztwo:{ label:'👮 Kontakt z dowództwem',description:'Kontakt z dowództwem GROM.' }
};
const ALL_TICKET_TYPES = { ...CITIZEN_TICKETS, ...GROM_TICKETS };

const SERVER_STRUCTURE = [
  { name:'📂 STEFA OBYWATELA', citizen:true, channels:['📜・regulamin','📢・komunikaty','ℹ️・informacje-dla-obywateli','🎫・centrum-ticketów','💬・rozmowy','📝・podania','📩・wyniki-podań','📝・egzamin','📩・wyniki-egzaminu','❓・najczęstsze-pytania','📞・kontakt-z-grom'] },
  { name:'🏅 DOWÓDZTWO GROM', channels:['📣・rozkazy','🎖️・dowództwo','📁・decyzje-kadry','📝・odprawy','📜・regulamin-wewnętrzny'] },
  { name:'🛡️ SŁUŻBA GROM', channels:['🛡️・służba','📊・grafik','📋・raporty','🚨・meldunki','📍・działania-operacyjne'] },
  { name:'📂 KADRY I DOKUMENTACJA GROM', channels:['👤・kadra','📁・dokumentacja','🪪・numery-grom','📈・awanse-i-degradacje','🎖️・stopnie'] },
  { name:'🎯 SZKOLENIA GROM', channels:['🎯・szkolenia','📚・materiały-szkoleniowe','🏆・wyniki-szkoleń','📝・testy-szkoleniowe'] },
  { name:'📻 ŁĄCZNOŚĆ GROM', channels:['📻・łączność','💬・rozmowy-kadry','📢・odprawy-łączności'] },
  { name:'📋 LOGI SYSTEMOWE GROM', channels:['📋・logi-kadrowe','🎫・logi-ticketów','⚙️・logi-systemowe','📁・archiwum'] },
  { name:'🎫 TICKETY GROM', channels:['🎫・centrum-ticketów-grom','📁・archiwum-ticketów'] }
];

const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers] });
const commands = [
  new SlashCommandBuilder().setName('grom-id').setDescription('Nadaje numer ewidencyjny GROM').addUserOption(o=>o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-awans').setDescription('Awansuje funkcjonariusza o jeden stopień').addUserOption(o=>o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-degradacja').setDescription('Degraduje funkcjonariusza o jeden stopień').addUserOption(o=>o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-stopien').setDescription('Ustawia konkretny stopień funkcjonariusza').addUserOption(o=>o.setName('osoba').setDescription('Osoba').setRequired(true)).addStringOption(o=>o.setName('stopien').setDescription('Nowy stopień').setRequired(true).addChoices(...RANKS.map(rank=>({name:rank,value:rank})))),
  new SlashCommandBuilder().setName('grom-info').setDescription('Pokazuje kartę funkcjonariusza').addUserOption(o=>o.setName('osoba').setDescription('Osoba').setRequired(true)),
  new SlashCommandBuilder().setName('grom-logi').setDescription('Ustawia istniejący kanał logów').addChannelOption(o=>o.setName('kanal').setDescription('Istniejący kanał tekstowy').setRequired(true).addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('grom-struktura').setDescription('Pokazuje hierarchię stopni GROM RP'),
  new SlashCommandBuilder().setName('grom-utworz-strukture').setDescription('Tworzy brakujące kategorie i kanały GROM').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('grom-ticket-panel').setDescription('Wysyła publiczny panel ticketów dla obywateli').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('grom-ticket-panel-wewnetrzny').setDescription('Wysyła wewnętrzny panel ticketów GROM').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c=>c.toJSON());

function isStaff(member){return member.permissions.has(PermissionFlagsBits.ManageGuild)||member.permissions.has(PermissionFlagsBits.Administrator);}
function isGromMember(member){return !!member&&(isStaff(member)||member.roles.cache.some(r=>GROM_ACCESS_ROLES.includes(r.name)));}
function ensureMember(id){if(!data.members[id])data.members[id]={number:null,rank:'Szeregowy',joinedAt:null,history:[]};return data.members[id];}
function rankIndex(rank){return RANKS.indexOf(rank);}
function findRankRole(guild,rank){return guild.roles.cache.find(r=>r.name===rank);}
function getGromRoles(guild){return guild.roles.cache.filter(r=>GROM_ACCESS_ROLES.includes(r.name));}
async function syncRank(member,rank){const target=findRankRole(member.guild,rank);if(!target)return false;for(const oldRank of RANKS){const old=findRankRole(member.guild,oldRank);if(old&&old.id!==target.id&&member.roles.cache.has(old.id))await member.roles.remove(old).catch(()=>{});}await member.roles.add(target).catch(()=>{});return true;}
function getTextChannelByName(guild,name){return guild.channels.cache.find(c=>c.type===ChannelType.GuildText&&c.name===name);}
async function sendLog(guild,title,description,ticket=false){const configured=data.settings.logChannelId?guild.channels.cache.get(data.settings.logChannelId):null;const fallback=getTextChannelByName(guild,ticket?'🎫・logi-ticketów':'📋・logi-kadrowe');const channel=configured?.isTextBased()?configured:fallback;if(!channel)return;await channel.send({embeds:[new EmbedBuilder().setTitle(`🇵🇱 GROM • ${title}`).setDescription(description).setTimestamp().setFooter({text:'GROM • System RP'})]}).catch(()=>{});}
function categoryOverwrites(guild,citizen){if(citizen)return[{id:guild.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory]}];const out=[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]}];for(const role of getGromRoles(guild).values())out.push({id:role.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.SendMessages]});return out;}
async function ensureServerStructure(guild){const summary={categoriesCreated:0,channelsCreated:0,permissionsUpdated:0};for(const section of SERVER_STRUCTURE){let category=guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name===section.name);if(!category){category=await guild.channels.create({name:section.name,type:ChannelType.GuildCategory,permissionOverwrites:categoryOverwrites(guild,!!section.citizen)});summary.categoriesCreated++;}else{await category.permissionOverwrites.set(categoryOverwrites(guild,!!section.citizen)).catch(()=>{});summary.permissionsUpdated++;}for(const name of section.channels){let channel=guild.channels.cache.find(c=>c.type===ChannelType.GuildText&&c.name===name);if(!channel){await guild.channels.create({name,type:ChannelType.GuildText,parent:category.id});summary.channelsCreated++;}else if(channel.parentId!==category.id)await channel.setParent(category.id,{lockPermissions:true}).catch(()=>{});}}return summary;}
function selectOptions(types){return Object.entries(types).map(([key,info])=>({label:info.label.replace(/^\S+\s/,'').slice(0,100),description:info.description.slice(0,100),value:key,emoji:info.label.match(/^\S+/)?.[0]}));}
function citizenPanel(){const select=new StringSelectMenuBuilder().setCustomId('grom_ticket_citizen_select').setPlaceholder('📨 Wybierz rodzaj sprawy...').addOptions(selectOptions(CITIZEN_TICKETS));return{embeds:[new EmbedBuilder().setTitle('🇵🇱 GROM • CENTRUM TICKETÓW').setDescription('Wybierz rodzaj sprawy z listy. Bot utworzy prywatny kanał dla Ciebie i uprawnionej kadry GROM.\n\n📌 **Rekrutacja i egzamin są obsługiwane przez osobne boty.**\n🔒 Nie wysyłaj haseł, tokenów ani danych logowania.').addFields({name:'👤 Dla obywateli',value:'Pomoc • kontakt • zgłoszenia • skargi • wnioski • współpraca i inne'},{name:'🎫 Jak działa ticket?',value:'Wybierz kategorię → bot tworzy prywatny kanał → po zakończeniu kadra zamyka ticket.'}).setFooter({text:'GROM • Oficjalny system ticketów RP'})],components:[new ActionRowBuilder().addComponents(select)]};}
function internalPanel(){const select=new StringSelectMenuBuilder().setCustomId('grom_ticket_internal_select').setPlaceholder('🪖 Wybierz wewnętrzną sprawę GROM...').addOptions(selectOptions(GROM_TICKETS));return{embeds:[new EmbedBuilder().setTitle('🛡️ GROM • TICKETY WEWNĘTRZNE').setDescription('Panel przeznaczony dla funkcjonariuszy GROM.\n\nWybierz rodzaj sprawy. Ticket będzie widoczny dla autora oraz uprawnionych osób GROM.').setFooter({text:'GROM • Wewnętrzny system ticketów RP'})],components:[new ActionRowBuilder().addComponents(select)]};}
function closeButton(){return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('grom_ticket_close').setLabel('Zamknij ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));}

async function createTicket(interaction,type,internal){const info=ALL_TICKET_TYPES[type];if(!info)return interaction.reply({content:'❌ Nieprawidłowy rodzaj ticketu.',ephemeral:true});if(internal&&!isGromMember(interaction.member))return interaction.reply({content:'❌ Ten ticket jest dostępny tylko dla GROM.',ephemeral:true});const existing=Object.values(data.tickets).find(t=>t.userId===interaction.user.id&&t.guildId===interaction.guild.id&&t.open);if(existing){const ch=interaction.guild.channels.cache.get(existing.channelId);if(ch)return interaction.reply({content:`❌ Masz już otwarty ticket: ${ch}`,ephemeral:true});existing.open=false;}const category=interaction.guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name==='🎫 TICKETY GROM');if(!category)return interaction.reply({content:'❌ Brak kategorii **🎫 TICKETY GROM**. Uruchom `/grom-utworz-strukture`.',ephemeral:true});const safe=interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').slice(0,16)||'uzytkownik';const channelName=`ticket-${type}-${safe}`.slice(0,95);const overwrites=[{id:interaction.guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]},{id:interaction.client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages]}];for(const role of getGromRoles(interaction.guild).values())overwrites.push({id:role.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageMessages]});const channel=await interaction.guild.channels.create({name:channelName,type:ChannelType.GuildText,parent:category.id,topic:`GROM • ${info.label} • ${internal?'WEWNĘTRZNY':'OBYWATEL'} • Autor: ${interaction.user.tag}`,permissionOverwrites:overwrites});data.tickets[channel.id]={channelId:channel.id,guildId:interaction.guild.id,userId:interaction.user.id,type,internal,open:true,createdAt:new Date().toISOString()};save();const embed=new EmbedBuilder().setTitle(`🇵🇱 GROM • ${info.label}`).setDescription(`Witaj ${interaction.user}!\n\n**Rodzaj sprawy:** ${info.description}\n\nOpisz dokładnie swoją sprawę. Uprawniona kadra GROM odpowie tutaj.\n\n🔒 Ticket jest prywatny.\n📌 Rekrutacja i egzamin są obsługiwane przez osobne boty.`).setTimestamp().setFooter({text:'GROM • System ticketów RP'});await channel.send({content:`${interaction.user} • 📢 **Nowe zgłoszenie GROM**`,embeds:[embed],components:[closeButton()]});await interaction.reply({content:`✅ Utworzono ticket: ${channel}`,ephemeral:true});await sendLog(interaction.guild,'Nowy ticket',`**${interaction.user.tag}** otworzył ${internal?'wewnętrzny ':''}ticket ${channel}.\n**Typ:** ${info.label}`,true);}

async function closeTicket(interaction){const ticket=data.tickets[interaction.channel.id];if(!ticket)return interaction.reply({content:'❌ To nie jest ticket GROM.',ephemeral:true});if(ticket.userId!==interaction.user.id&&!isGromMember(interaction.member))return interaction.reply({content:'❌ Tylko autor ticketu lub GROM może go zamknąć.',ephemeral:true});if(!ticket.open)return interaction.reply({content:'ℹ️ Ten ticket jest już zamknięty.',ephemeral:true});ticket.open=false;ticket.closedAt=new Date().toISOString();ticket.closedBy=interaction.user.id;save();const archive=getTextChannelByName(interaction.guild,'📁・archiwum-ticketów');await interaction.channel.permissionOverwrites.edit(ticket.userId,{ViewChannel:false,SendMessages:false,ReadMessageHistory:false}).catch(()=>{});await interaction.channel.permissionOverwrites.edit(interaction.guild.id,{ViewChannel:false}).catch(()=>{});for(const role of getGromRoles(interaction.guild).values())await interaction.channel.permissionOverwrites.edit(role.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,ManageMessages:true}).catch(()=>{});await interaction.reply('🔒 **Ticket zamknięty.** Dostęp obywatela został odebrany.');const oldName=interaction.channel.name;await interaction.channel.setName(`arch-${ticket.type}-${oldName.replace(/^ticket-/,'').slice(0,70)}`).catch(()=>{});if(archive)await archive.send({embeds:[new EmbedBuilder().setTitle('📁 GROM • Archiwum ticketu').setDescription(`**Ticket:** #${interaction.channel.name}\n**Autor:** <@${ticket.userId}>\n**Typ:** ${ALL_TICKET_TYPES[ticket.type]?.label||ticket.type}\n**Zamknął:** ${interaction.user}\n**Kanał:** ${interaction.channel}`).setTimestamp().setFooter({text:'GROM • Archiwum ticketów RP'})]}).catch(()=>{});await sendLog(interaction.guild,'Zamknięto ticket',`Ticket **#${interaction.channel.name}** został zamknięty przez **${interaction.user.tag}**.`,true);}

client.once('clientReady',async readyClient=>{try{const rest=new REST({version:'10'}).setToken(TOKEN);await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});const guild=readyClient.guilds.cache.get(GUILD_ID);if(guild){const summary=await ensureServerStructure(guild);console.log(`🏗️ Struktura GROM: +${summary.categoriesCreated} kategorii, +${summary.channelsCreated} kanałów.`);}console.log(`✅ GROM bot zalogowany jako ${readyClient.user.tag}`);console.log('🎫 System ticketów GROM: ONLINE');}catch(error){console.error('❌ Błąd uruchamiania GROM:',error);}});

client.on('interactionCreate',async interaction=>{if(!interaction.guild)return;try{if(interaction.isStringSelectMenu()){if(interaction.customId==='grom_ticket_citizen_select'){await createTicket(interaction,interaction.values[0],false);return;}if(interaction.customId==='grom_ticket_internal_select'){await createTicket(interaction,interaction.values[0],true);return;}}if(interaction.isButton()&&interaction.customId==='grom_ticket_close'){await closeTicket(interaction);return;}if(!interaction.isChatInputCommand())return;const guild=interaction.guild;
if(interaction.commandName==='grom-id'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});const user=interaction.options.getUser('osoba');const record=ensureMember(user.id);if(!record.number){record.number=`GROM-${String(data.nextNumber).padStart(3,'0')}`;data.nextNumber++;record.joinedAt=record.joinedAt||new Date().toISOString();save();}await interaction.reply(`🆔 ${user} posiada numer **${record.number}**.`);await sendLog(guild,'Nadano numer',`**${user.tag}** → **${record.number}**. Nadał: ${interaction.user}.`);return;}
if(interaction.commandName==='grom-stopien'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});const user=interaction.options.getUser('osoba');const newRank=interaction.options.getString('stopien');const member=await guild.members.fetch(user.id).catch(()=>null);if(!member)return interaction.reply({content:'❌ Osoba nie znajduje się na serwerze.',ephemeral:true});const record=ensureMember(user.id);const oldRank=record.rank;record.rank=newRank;record.history.push({type:'zmiana-stopnia',from:oldRank,to:newRank,by:interaction.user.id,at:new Date().toISOString()});save();const synced=await syncRank(member,newRank);await interaction.reply(synced?`🎖️ ${user}: **${oldRank}** → **${newRank}**. Rola zsynchronizowana.`:`🎖️ ${user}: **${oldRank}** → **${newRank}**. ⚠️ Rola nie istnieje.`);await sendLog(guild,'Zmiana stopnia',`**${user.tag}**: ${oldRank} → **${newRank}**. Wykonał: ${interaction.user}.`);return;}
if(interaction.commandName==='grom-awans'||interaction.commandName==='grom-degradacja'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});const user=interaction.options.getUser('osoba');const member=await guild.members.fetch(user.id).catch(()=>null);if(!member)return interaction.reply({content:'❌ Osoba nie znajduje się na serwerze.',ephemeral:true});const record=ensureMember(user.id);const current=rankIndex(record.rank);const next=current+(interaction.commandName==='grom-awans'?1:-1);if(next<0||next>=RANKS.length)return interaction.reply({content:`ℹ️ Nie można wykonać operacji dla stopnia **${record.rank}**.`,ephemeral:true});const oldRank=record.rank;const newRank=RANKS[next];record.rank=newRank;record.history.push({type:interaction.commandName,from:oldRank,to:newRank,by:interaction.user.id,at:new Date().toISOString()});save();const synced=await syncRank(member,newRank);const action=interaction.commandName==='grom-awans'?'Awans':'Degradacja';await interaction.reply(`🎖️ **${action}** ${user}: **${oldRank}** → **${newRank}**.${synced?' Rola zsynchronizowana.':' ⚠️ Brak odpowiedniej roli.'}`);await sendLog(guild,action,`**${user.tag}**: ${oldRank} → **${newRank}**. Wykonał: ${interaction.user}.`);return;}
if(interaction.commandName==='grom-info'){const user=interaction.options.getUser('osoba');const record=data.members[user.id];if(!record)return interaction.reply({content:'❌ Brak karty tej osoby.',ephemeral:true});const embed=new EmbedBuilder().setTitle('🛡️ GROM • Karta funkcjonariusza').setDescription('🇵🇱 **Jednostka GROM • System kadrowy RP**').addFields({name:'👤 Osoba',value:`${user}`,inline:true},{name:'🆔 Numer',value:record.number||'Nie nadano',inline:true},{name:'🎖️ Stopień',value:record.rank||'Nieustalony',inline:true},{name:'📅 Data przyjęcia',value:record.joinedAt?`<t:${Math.floor(new Date(record.joinedAt).getTime()/1000)}:d>`:'Nieustalona',inline:true},{name:'📋 Historia zmian',value:String(record.history?.length||0),inline:true}).setFooter({text:'GROM • System kadrowy RP'});return interaction.reply({embeds:[embed],ephemeral:true});}
if(interaction.commandName==='grom-logi'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});const channel=interaction.options.getChannel('kanal');data.settings.logChannelId=channel.id;save();return interaction.reply(`✅ Ustawiono kanał logów: ${channel}.`);}
if(interaction.commandName==='grom-struktura')return interaction.reply({embeds:[new EmbedBuilder().setTitle('🇵🇱 GROM • Hierarchia RP').setDescription(RANKS.map((r,i)=>`**${i+1}.** ${r}`).join('\n')).setFooter({text:'GROM • System stopni RP'})]});
if(interaction.commandName==='grom-utworz-strukture'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});await interaction.deferReply({ephemeral:true});const summary=await ensureServerStructure(guild);await interaction.editReply(`✅ **Struktura GROM została sprawdzona.**\n📂 Utworzono kategorii: **${summary.categoriesCreated}**\n📝 Utworzono kanałów: **${summary.channelsCreated}**\n🔒 Zaktualizowano uprawnienia: **${summary.permissionsUpdated}**\n\n👥 Strefa obywatela = publiczna\n🛡️ Strefy GROM = tylko role GROM.`);return;}
if(interaction.commandName==='grom-ticket-panel'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});await interaction.channel.send(citizenPanel());return interaction.reply({content:'✅ Publiczny panel ticketów dla obywateli został wysłany.',ephemeral:true});}
if(interaction.commandName==='grom-ticket-panel-wewnetrzny'){if(!isStaff(interaction.member))return interaction.reply({content:'❌ Brak uprawnień.',ephemeral:true});if(!isGromMember(interaction.member))return interaction.reply({content:'❌ Brak dostępu GROM.',ephemeral:true});await interaction.channel.send(internalPanel());return interaction.reply({content:'✅ Wewnętrzny panel ticketów GROM został wysłany.',ephemeral:true});}
}catch(error){console.error('❌ GROM interaction error:',error);if(interaction.deferred)await interaction.editReply({content:'❌ Wystąpił błąd. Sprawdź logi Render.'}).catch(()=>{});else if(!interaction.replied)await interaction.reply({content:'❌ Wystąpił błąd. Spróbuj ponownie.',ephemeral:true}).catch(()=>{});}});

client.login(TOKEN).catch(error=>{console.error('❌ Nie udało się zalogować bota:',error.message);process.exit(1);});
