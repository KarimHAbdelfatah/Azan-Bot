require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const cron = require('node-cron');
const fetch = require('node-fetch');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Configuration
const CHANNEL_ID = process.env.CHANNEL_ID;
const CITY = process.env.CITY || 'Dubai';
const COUNTRY = process.env.COUNTRY || 'AE';
const METHOD = process.env.METHOD || '4';
const AZAN_AUDIO_PATH = '/app/azan-short.mp3'; // Absolute path on Railway

let prayerTimes = {};
let activeConnections = new Map();

// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('prayertimes')
        .setDescription('Show today\'s prayer times'),
    new SlashCommandBuilder()
        .setName('nextprayer')
        .setDescription('Show when the next prayer is'),
    new SlashCommandBuilder()
        .setName('test')
        .setDescription('Test azan notification (admin only)')
].map(command => command.toJSON());

// Register commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Slash commands registered');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Fetch prayer times from Aladhan API
async function fetchPrayerTimes() {
    try {
        const url = `http://api.aladhan.com/v1/timingsByCity?city=${CITY}&country=${COUNTRY}&method=${METHOD}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.code === 200) {
            prayerTimes = data.data.timings;
            console.log('Prayer times updated:', prayerTimes);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error fetching prayer times:', error);
        return false;
    }
}

// Find all voice channels with users
function getOccupiedVoiceChannels(guild) {
    const voiceChannels = [];
    guild.channels.cache.forEach(channel => {
        if (channel.type === 2 && channel.members.size > 0) { // Type 2 = Voice Channel
            voiceChannels.push(channel);
        }
    });
    return voiceChannels;
}

// Play Azan in voice channel
async function playAzanInChannel(voiceChannel) {
    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(AZAN_AUDIO_PATH);

        connection.subscribe(player);
        player.play(resource);

        console.log(`🔊 Playing Azan in: ${voiceChannel.name} (${voiceChannel.guild.name})`);

        // Leave after audio finishes
        player.on(AudioPlayerStatus.Idle, () => {
            connection.destroy();
            console.log(`✅ Left ${voiceChannel.name}`);
        });

        // Error handling - leave if audio fails
        player.on('error', error => {
            console.error(`Audio player error in ${voiceChannel.name}:`, error);
            connection.destroy();
            console.log(`❌ Left ${voiceChannel.name} due to error`);
        });

        // Safety timeout - leave after 15 seconds no matter what
        setTimeout(() => {
            if (connection.state.status !== 'destroyed') {
                connection.destroy();
                console.log(`⏱️ Left ${voiceChannel.name} (timeout)`);
            }
        }, 15000);

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            connection.destroy();
        });

    } catch (error) {
        console.error(`Error playing Azan in ${voiceChannel.name}:`, error);
    }
}

// Send text notification and play audio
async function sendAzan(prayerName) {
    // Send text notification
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (channel) {
        const embed = {
            color: 0x00b894,
            title: `🕌 ${prayerName} Prayer Time`,
            description: `It's time for ${prayerName} prayer.\n\nاَللّٰهُ أَكْبَرُ اَللّٰهُ أَكْبَرُ`,
            timestamp: new Date(),
            footer: { text: `${CITY}, ${COUNTRY}` }
        };
        
        await channel.send({ embeds: [embed] });
        console.log(`📢 Sent ${prayerName} text notification`);
    }

    // Play Azan in all occupied voice channels
    client.guilds.cache.forEach(guild => {
        const occupiedChannels = getOccupiedVoiceChannels(guild);
        occupiedChannels.forEach(voiceChannel => {
            playAzanInChannel(voiceChannel);
        });
    });
}

// Check and send Azan
function checkPrayerTime() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    
    for (const prayer of prayers) {
        if (prayerTimes[prayer] && prayerTimes[prayer].substring(0, 5) === currentTime) {
            sendAzan(prayer);
        }
    }
}

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    
    // Register commands
    registerCommands();
    
    // Fetch prayer times immediately
    fetchPrayerTimes();
    
    // Update prayer times daily at midnight
    cron.schedule('0 0 * * *', () => {
        console.log('Updating prayer times...');
        fetchPrayerTimes();
    });
    
    // Check every minute for prayer times
    cron.schedule('* * * * *', () => {
        checkPrayerTime();
    });
    
    console.log(`🕌 Azan bot active for ${CITY}, ${COUNTRY}`);
    console.log(`📢 Text notifications: ${CHANNEL_ID}`);
    console.log(`🔊 Voice enabled: Will join occupied channels`);
    console.log(`🎵 Audio file: ${AZAN_AUDIO_PATH}`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'prayertimes') {
        const times = `**🕌 Prayer Times for ${CITY}, ${COUNTRY}**\n\n` +
            `🌅 **Fajr:** ${prayerTimes.Fajr || 'Loading...'}\n` +
            `☀️ **Dhuhr:** ${prayerTimes.Dhuhr || 'Loading...'}\n` +
            `🌤️ **Asr:** ${prayerTimes.Asr || 'Loading...'}\n` +
            `🌆 **Maghrib:** ${prayerTimes.Maghrib || 'Loading...'}\n` +
            `🌙 **Isha:** ${prayerTimes.Isha || 'Loading...'}`;
        
        await interaction.reply(times);
    }

    else if (commandName === 'nextprayer') {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
        let nextPrayer = null;
        
        for (const prayer of prayers) {
            if (prayerTimes[prayer] && prayerTimes[prayer] > currentTime) {
                nextPrayer = { name: prayer, time: prayerTimes[prayer] };
                break;
            }
        }
        
        if (!nextPrayer) {
            nextPrayer = { name: 'Fajr', time: prayerTimes.Fajr };
        }
        
        await interaction.reply(`⏰ **Next Prayer:** ${nextPrayer.name} at ${nextPrayer.time}`);
    }

    else if (commandName === 'test') {
        // Check if user has admin permissions
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ content: '❌ Only admins can use this command', ephemeral: true });
            return;
        }
        
        await interaction.reply({ content: '🔔 Sending test azan...', ephemeral: true });
        setTimeout(() => sendAzan('Test'), 100);
    }
});

client.login(process.env.DISCORD_TOKEN);
