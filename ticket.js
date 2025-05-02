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
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'sendpanel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: 'Bu komutu sadece yöneticiler kullanabilir.',
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor('#00AEEF')
        .setTitle('🎟️ **SCHWARZDEV Tickets** 🎟️')
        .setDescription(
          `Merhaba! Aşağıdaki menüden ihtiyacınıza uygun olan ticket türünü seçebilirsiniz.\n\n` +
          `🔹 **Satın Alma**: Bir şey satın almak istiyorsanız, **Satın Alma Bileti** seçin.\n` +
          `🔹 **Destek**: Destek almak, sorular sormak veya başvuru yapmak için **Destek Bileti** seçin.`
        )
        .setFooter({
          text: 'SCHWARZDEV Destek Ekibi',
          iconURL: 'https://cdn.discordapp.com/attachments/1367387231441911851/1367481879246147615/standard.gif',
        })
        .setThumbnail('https://cdn.discordapp.com/attachments/1367387231441911851/1367481879246147615/standard.gif')
        .setImage(
          'https://cdn.discordapp.com/attachments/1367387231441911851/1367488281394020502/350kb.gif'
        );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_ticket_type')
        .setPlaceholder('Bir Kategori Seçin!')
        .addOptions([
          {
            label: 'Satın Alma',
            value: 'purchase_ticket',
            description: 'Satın alma talepleri için.',
          },
          {
            label: 'Destek',
            value: 'support_ticket',
            description: 'Destek talepleri için.',
          },
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
    } else if (interaction.commandName === 'add') {
      const user = interaction.options.getUser('user');
      const channel = interaction.channel;

      if (!channel.name.startsWith('buy-') && !channel.name.startsWith('sup-')) {
        return interaction.reply({
          content: 'Bu komut yalnızca bir ticket kanalında kullanılabilir.',
          ephemeral: true,
        });
      }

      await channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
      });

      interaction.reply({
        content: `${user} başarıyla ticketa eklendi!`,
        ephemeral: true,
      });
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
  const guild = interaction.guild;
  const member = interaction.member;
  const categoryName = ticketType === 'buy' ? 'Satın Alma' : 'Destek';
  let category = guild.channels.cache.find(
    (c) => c.name === categoryName && c.type === ChannelType.GuildCategory
  );

  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    });
  }

  if (!ticketCounters[ticketType]) ticketCounters[ticketType] = 0;
  ticketCounters[ticketType]++;
  const channelName = `${ticketType}-${ticketCounters[ticketType]}`;

  await saveCounters();

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ];

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites,
  });

  const ticketEmbed = new EmbedBuilder()
    .setColor('#00AEEF')
    .setTitle(`🎫 **${ticketType === 'buy' ? 'Satın Alma' : 'Destek'} Ticket** 🎫`)
    .setDescription(
      `Merhaba ${member}, bu kanal senin için oluşturuldu. Destek ekibimiz kısa süre içinde yardımcı olacaktır.\n\n` +
      `📌 **Not:** Ticket'ınızı kapatmak için aşağıdaki **"Ticket Kapat"** butonunu kullanabilirsiniz.`
    )
    .setFooter({
      text: 'SCHWARZDEV Destek Ekibi',
      iconURL: 'https://cdn.discordapp.com/attachments/1367387231441911851/1367481879246147615/standard.gif',
    });

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('🎟️ Ticket Kapat')
      .setStyle(ButtonStyle.Danger)
  );

  const claimButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('🔒 Claim Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔒')
  );

  await channel.send({ embeds: [ticketEmbed], components: [button, claimButton] });
  await interaction.reply({ content: `Ticket başarıyla oluşturuldu: ${channel}`, ephemeral: true });

  usersWithOpenTickets.set(interaction.user.id, channel.name);

  const timeout = setTimeout(async () => {
    try {
      await channel.delete();
      usersWithOpenTickets.delete(interaction.user.id);
      console.log(`Ticket ${channelName} otomatik olarak kapatıldı.`);
    } catch (error) {
      console.error(`Ticket ${channelName} kapatılırken hata oluştu:`, error);
    }
  }, 24 * 60 * 60 * 1000);

  ticketTimeouts.set(channel.id, timeout);
}

client.login(TOKEN);
