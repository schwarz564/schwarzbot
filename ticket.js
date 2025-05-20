require('./keepalive.js');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const fs = require('fs').promises;
require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.BOT_TOKEN;
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID;
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('sendpanel')
    .setDescription('Destek paneli gönderir.'),
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Bir kullanıcıyı ticketa ekler.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Eklemek istediğiniz kullanıcı.').setRequired(true)
    ),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Komutlar kaydediliyor...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map((command) => command.toJSON()),
    });
    console.log('Komutlar başarıyla kaydedildi!');
  } catch (error) {
    console.error(error);
  }
})();

let ticketCounters = {};
let usersWithOpenTickets = new Map();
let ticketTimeouts = new Map();

async function loadCounters() {
  try {
    const data = await fs.readFile('ticketCounters.json', 'utf8');
    ticketCounters = JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Ticket sayaçları dosyası bulunamadı, yeni bir dosya oluşturulacak.');
      await fs.writeFile('ticketCounters.json', '{}');
    } else {
      console.error('Ticket sayaçları yüklenirken hata oluştu:', error);
    }
  }
}

async function saveCounters() {
  try {
    await fs.writeFile('ticketCounters.json', JSON.stringify(ticketCounters, null, 2));
  } catch (error) {
    console.error('Ticket sayaçları kaydedilirken hata oluştu:', error);
  }
}

client.once('ready', async () => {
  await loadCounters();
  console.log(`Bot ${client.user.tag} olarak giriş yaptı!`);

  try {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setColor('#00AEEF')
      .setTitle('🎟️ **FLEXWARE Tickets** 🎟️')
      .setDescription(
        `Hello! You can choose the ticket type that suits your needs from the menu below.\n\n` +
        `🔹 Purchase: If you want to buy something, select Purchase Ticket.\n` +
        `🔹 Support: Select Support Ticket to get support, ask questions or submit an application.`
      )
      .setFooter({
        text: 'FLEXWARE Support Team',
        iconURL: 'https://media.discordapp.net/attachments/1373088819989188620/1374201092979818516/20250520_0443_Futuristic_Chrome_Emblem_simple_compose_01jvnnqjzhf7r9c7z3e0pxdyzm.png',
      })
      .setThumbnail('https://media.discordapp.net/attachments/1373088819989188620/1374201092979818516/20250520_0443_Futuristic_Chrome_Emblem_simple_compose_01jvnnqjzhf7r9c7z3e0pxdyzm.png')
      .setImage('https://cdn.discordapp.com/attachments/1373009493973270569/1374208087212425276/standard.gif');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_ticket_type')
      .setPlaceholder('Bir Kategori Seçin!')
      .addOptions([
        {
          label: 'BUY',
          value: 'purchase_ticket',
          description: 'For purchase requests.',
        },
        {
          label: 'Support',
          value: 'support_ticket',
          description: 'For support requests.',
        },
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await channel.send({ embeds: [embed], components: [row] });
    console.log('Panel otomatik olarak gönderildi.');
  } catch (err) {
    console.error('Panel gönderilemedi:', err);
  }
});

// Aşağısı: interaction işlemleri ve createTicket fonksiyonu (dokunulmadı)

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'sendpanel') {
      // ... bu kısmı koruyabilirsin, ama artık gerek kalmadı
    } else if (interaction.commandName === 'add') {
      // ... kullanıcı ekleme komutu
    }
  } else if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
    if (usersWithOpenTickets.has(interaction.user.id)) {
      return interaction.reply({
        content: `Zaten açık bir ticket'ınız var: **${usersWithOpenTickets.get(interaction.user.id)}**. Lütfen onu kapatın veya destek alın.`,
        ephemeral: true,
      });
    }

    const ticketType = interaction.values[0].includes('purchase') ? 'buy' : 'sup';
    await createTicket(interaction, ticketType);
  } else if (interaction.isButton()) {
    if (interaction.customId === 'close_ticket') {
      const channel = interaction.channel;

      if (channel.name.startsWith('buy-') || channel.name.startsWith('sup-')) {
        const ticketOwner = channel.permissionOverwrites.cache.find(
          (overwrite) =>
            overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
            overwrite.id !== SUPPORT_ROLE_ID &&
            overwrite.id !== interaction.guild.id
        );

        if (ticketOwner) {
          usersWithOpenTickets.delete(ticketOwner.id);
        }

        clearTimeout(ticketTimeouts.get(channel.id));
        ticketTimeouts.delete(channel.id);

        await interaction.reply({
          content: 'Ticket **kapatılıyor**, kanal **siliniyor...**',
          ephemeral: true,
        });

        setTimeout(async () => {
          await channel.delete();
        }, 3000);
      } else {
        await interaction.reply({
          content: 'Bu komut yalnızca bir **ticket kanalında** kullanılabilir.',
          ephemeral: true,
        });
      }
    }
  }
});

async function createTicket(interaction, ticketType) {
  // ... ticket oluşturma fonksiyonu (aynı şekilde korunur)
}

client.login(TOKEN);
