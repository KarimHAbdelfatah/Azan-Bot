require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
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

// CONFIG
const CHANNEL_ID = process.env.CHANNEL_ID;
const CITY = process.env.CITY || 'Cairo';
const COUNTRY = process.env.COUNTRY || 'EG';
const METHOD = process.env.METHOD || '4';
const AZAN_AUDIO_PATH = path.join(__dirname, 'azan-short.mp3');

let prayerTimes = {};

// SLASH COMMANDS
const commands = [
    new SlashCommandBuilder().setName('prayertimes').setDescription('Show prayer times'),
    new SlashCommandBuilder().setName('nextprayer').setDescription('Show next prayer'),
    new SlashCommandBuilder().setName('test').setDescription('Test azan').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Commands registered');
    } catch (error) {
        console.error('❌ Command registration failed:', error);
    }
}

async function fetchPrayerTimes() {
    try {
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${CITY}&country=${COUNTRY}&method=${METHOD}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.code === 200) {
            prayerTimes = data.data.timings;
            console.log('✅ Prayer times updated');
        }
    } catch (error) {
        console.error('❌ Prayer times fetch error:', error);
    }
}

function getOccupiedVoiceChannels(guild) {
    return guild.channels.cache.filter(channel => 
        channel.type === 2 && channel.members.size > 0
    );
}

async function playAzanInChannel(voiceChannel) {
    try {
        console.log(`🎯 Joining ${voiceChannel.name}`);
        
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });

        console.log(`🔗 Connection created, status: ${connection.state.status}`);

        // Log all connection state changes
        connection.on('stateChange', (oldState, newState) => {
            console.log(`🔊 Connection: ${oldState.status} -> ${newState.status}`);
            
            // When connection becomes ready, unpause the player if needed
            if (newState.status === 'ready' && player.state.status === 'autopaused') {
                console.log(`🔓 Connection ready - unpausing player`);
                player.unpause();
            }
        });

        connection.on('error', error => {
            console.error(`❌ Connection error:`, error);
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(AZAN_AUDIO_PATH);
        
        console.log(`🎵 Resource created`);
        
        // Log all player state changes
        player.on('stateChange', (oldState, newState) => {
            console.log(`🎶 Player: ${oldState.status} -> ${newState.status}`);
        });
        
        const subscription = connection.subscribe(player);
        console.log(`📡 Subscription: ${subscription ? 'SUCCESS' : 'FAILED'}`);
        
        player.play(resource);
        console.log(`▶️ Playing azan`);

        player.on(AudioPlayerStatus.Idle, () => {
            console.log(`⏹️ Player idle - destroying connection`);
            connection.destroy();
        });

        player.on('error', error => {
            console.error(`❌ Player error:`, error);
            connection.destroy();
        });

        // Timeout after 15 seconds
        setTimeout(() => {
            if (connection.state.status !== 'destroyed') {
                console.log(`⏱️ Timeout - forcing disconnect`);
                connection.destroy();
            }
        }, 15000);

    } catch (error) {
        console.error('❌ Playback error:', error);
    }
}

async function sendAzan(prayerName) {
    try {
        const channel = client.channels.cache.get(CHANNEL_ID);
        if (channel) {
            await channel.send({
                embeds: [{
                    color: 0x00b894,
                    title: `🕌 ${prayerName} Prayer Time`,
                    description: `It's time for ${prayerName} prayer.\n\nاَللّٰهُ أَكْبَرُ`,
                    timestamp: new Date(),
                    footer: { text: `${CITY}, ${COUNTRY}` }
                }]
            });
            console.log(`📢 Text notification sent`);
        }

        client.guilds.cache.forEach(guild => {
            const channels = getOccupiedVoiceChannels(guild);
            channels.forEach(channel => playAzanInChannel(channel));
        });
    } catch (error) {
        console.error('❌ sendAzan error:', error);
    }
}

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

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerCommands();
    await fetchPrayerTimes();
    
    cron.schedule('0 0 * * *', fetchPrayerTimes);
    cron.schedule('* * * * *', checkPrayerTime);
    
    console.log(`🕌 Bot active - ${CITY}, ${COUNTRY}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    if (commandName === 'prayertimes') {
        const msg = `🕌 **Prayer Times for ${CITY}, ${COUNTRY}**\n\n` +
            `🌅 Fajr: ${prayerTimes.Fajr}\n` +
            `☀️ Dhuhr: ${prayerTimes.Dhuhr}\n` +
            `🌤️ Asr: ${prayerTimes.Asr}\n` +
            `🌆 Maghrib: ${prayerTimes.Maghrib}\n` +
            `🌙 Isha: ${prayerTimes.Isha}`;
        await interaction.reply(msg);
    }
    else if (commandName === 'nextprayer') {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
        
        let nextPrayer = prayers.find(prayer => prayerTimes[prayer] > currentTime);
        if (!nextPrayer) nextPrayer = 'Fajr';
        
        await interaction.reply(`⏰ Next prayer: **${nextPrayer}** at **${prayerTimes[nextPrayer]}**`);
    }
    else if (commandName === 'test') {
        sendAzan('Test');
        interaction.reply({ content: '🔔 Test triggered!', ephemeral: true }).catch(() => {});
    }
});

client.login(process.env.DISCORD_TOKEN);
