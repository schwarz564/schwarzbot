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
const BUY_CATEGORY_ID = process.env.BUY_CATEGORY_ID;
const SUPPORT_CATEGORY_ID = process.env.SUPPORT_CATEGORY_ID;

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
    .addUserOption(option =>
      option.setName('user').setDescription('Eklemek istediğiniz kullanıcı.').setRequired(true)
    ),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Komutlar kaydediliyor...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(cmd => cmd.toJSON()),
    });
    console.log('Komutlar başarıyla yüklendi!');
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
      console.log('Sayaç dosyası yok, yenisi oluşturuluyor...');
      await fs.writeFile('ticketCounters.json', '{}');
    } else {
      console.error('Sayaç okunurken hata:', error);
    }
  }
}

async function saveCounters() {
  try {
    await fs.writeFile('ticketCounters.json', JSON.stringify(ticketCounters, null, 2));
  } catch (error) {
    console.error('Sayaç kaydedilirken hata:', error);
  }
}

client.once('ready', async () => {
  await loadCounters();
  console.log(`Bot giriş yaptı: ${client.user.tag}`);

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
        iconURL: 'https://cdn.discordapp.com/attachments/1373088819989188620/1374238174963830814/faxc231221_1.gif',
      })
      .setThumbnail('https://cdn.discordapp.com/attachments/1373088819989188620/1374238174963830814/faxc231221_1.gif')
      .setImage('https://cdn.discordapp.com/attachments/1373009493973270569/1374208087212425276/standard.gif');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_ticket_type')
      .setPlaceholder('Select a Category!')
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
    console.log('Panel gönderildi!');
  } catch (err) {
    console.error('Panel gönderilemedi:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'sendpanel') {
      // Panel gönderme komutu - zaten otomatik gönderiliyor
    } else if (interaction.commandName === 'add') {
      // Kullanıcı ekleme - bu kısım daha sonra yapılabilir
    }
  } else if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
    if (usersWithOpenTickets.has(interaction.user.id)) {
      return interaction.reply({
        content: `Zaten açık bir ticket'ınız var: **${usersWithOpenTickets.get(interaction.user.id)}**. Lütfen önce onu kapatın.`,
        ephemeral: true,
      });
    }

    const ticketType = interaction.values[0].includes('purchase') ? 'buy' : 'sup';
    await createTicket(interaction, ticketType);
  } else if (interaction.isButton() && interaction.customId === 'close_ticket') {
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
        content: 'Ticket kapatılıyor, kanal siliniyor...',
        ephemeral: true,
      });

      setTimeout(async () => {
        await channel.delete();
      }, 3000);
    } else {
      await interaction.reply({
        content: 'Bu sadece bir ticket kanalında kullanılabilir.',
        ephemeral: true,
      });
    }
  }
});

async function createTicket(interaction, ticketType) {
  try {
    await interaction.deferReply({ ephemeral: true });

    if (!ticketCounters[ticketType]) ticketCounters[ticketType] = 1;
    else ticketCounters[ticketType]++;

    await saveCounters();

    const channelName = `${ticketType}-${ticketCounters[ticketType]}`;
    let categoryId;

    if (ticketType === 'buy') categoryId = BUY_CATEGORY_ID;
    else if (ticketType === 'sup') categoryId = SUPPORT_CATEGORY_ID;

    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: SUPPORT_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
      ],
    });

    usersWithOpenTickets.set(interaction.user.id, channelName);

    const closeButton = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Kapat')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(closeButton);

    const embed = new EmbedBuilder()
      .setTitle('Ticket created')
      .setDescription(`Hello ${interaction.user}, the authorities will deal with you as soon as possible.`)
      .setColor('#00AEEF');

    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [row],
    });

    await interaction.editReply({
      content: `Ticket oluşturuldu: ${channel}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Ticket oluşturulurken hata:', error);
    await interaction.editReply({
      content: '❌ Ticket oluşturulurken hata oluştu.',
      ephemeral: true,
    });
  }
}

client.login(TOKEN);
