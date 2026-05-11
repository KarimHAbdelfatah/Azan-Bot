require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus
} = require('@discordjs/voice');

const cron = require('node-cron');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates
    ]
});


// =========================
// CONFIG
// =========================

const CHANNEL_ID = process.env.CHANNEL_ID;

const CITY = process.env.CITY || 'Dubai';
const COUNTRY = process.env.COUNTRY || 'AE';
const METHOD = process.env.METHOD || '4';

// TEST URL - direct MP3 that works
const AZAN_AUDIO_PATH = 'https://file-examples.com/storage/fe783855d66e29c8c45e1f2/2017/11/file_example_MP3_700KB.mp3';
const PLAY_DURATION = 10000; // 10 seconds

let prayerTimes = {};


// =========================
// SLASH COMMANDS
// =========================

const commands = [
    new SlashCommandBuilder()
        .setName('prayertimes')
        .setDescription('Show today prayer times'),

    new SlashCommandBuilder()
        .setName('nextprayer')
        .setDescription('Show next prayer'),

    new SlashCommandBuilder()
        .setName('test')
        .setDescription('Test azan')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

].map(cmd => cmd.toJSON());


// =========================
// REGISTER COMMANDS
// =========================

async function registerCommands() {
    try {

        const rest = new REST({ version: '10' })
            .setToken(process.env.DISCORD_TOKEN);

        console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log('✅ Slash commands registered');

    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}


// =========================
// FETCH PRAYER TIMES
// =========================

async function fetchPrayerTimes() {

    try {

        const url =
            `https://api.aladhan.com/v1/timingsByCity?city=${CITY}&country=${COUNTRY}&method=${METHOD}`;

        const response = await fetch(url);

        const data = await response.json();

        if (data.code === 200) {

            prayerTimes = data.data.timings;

            console.log('✅ Prayer times updated');
            console.log(prayerTimes);

            return true;
        }

        return false;

    } catch (error) {

        console.error('❌ Error fetching prayer times:', error);
        return false;
    }
}


// =========================
// GET OCCUPIED VOICE CHANNELS
// =========================

function getOccupiedVoiceChannels(guild) {

    const channels = [];

    guild.channels.cache.forEach(channel => {

        if (
            channel.type === 2 &&
            channel.members.size > 0
        ) {
            channels.push(channel);
        }
    });

    return channels;
}


// =========================
// PLAY AZAN
// =========================

async function playAzanInChannel(voiceChannel) {

    try {

        console.log(`🎯 Joining: ${voiceChannel.name}`);

        // Create connection
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false
        });

        console.log(`✅ Voice connection created`);

        // Create player
        const player = createAudioPlayer();

        // Create resource from URL
        const resource = createAudioResource(AZAN_AUDIO_PATH);

        // Subscribe immediately
        connection.subscribe(player);

        console.log(`🔗 Player subscribed`);

        // Debug logs
        player.on('stateChange', (oldState, newState) => {
            console.log(
                `🎵 Player: ${oldState.status} -> ${newState.status}`
            );
        });

        connection.on('stateChange', (oldState, newState) => {
            console.log(
                `🔊 Connection: ${oldState.status} -> ${newState.status}`
            );
        });

        // Errors
        player.on('error', error => {
            console.error('❌ Player error:', error);
            connection.destroy();
        });

        // Play immediately
        player.play(resource);

        console.log(`▶️ Playing azan`);

        // Stop after 10 seconds
        setTimeout(() => {
            try {
                player.stop();
                console.log(`⏱️ Stopped after 10s`);
            } catch (e) {}
        }, PLAY_DURATION);

        // Leave when done
        player.on(AudioPlayerStatus.Idle, () => {

            console.log(`⏹️ Finished`);

            setTimeout(() => {
                try {
                    connection.destroy();
                    console.log(`👋 Left channel`);
                } catch (e) {}
            }, 1000);
        });

        // Safety timeout
        setTimeout(() => {
            try {
                if (connection.state.status !== 'destroyed') {
                    connection.destroy();
                    console.log(`⏱️ Safety disconnect`);
                }
            } catch (e) {}
        }, 20000);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}


// =========================
// SEND AZAN
// =========================

async function sendAzan(prayerName) {

    try {

        // Text notification
        const channel = client.channels.cache.get(CHANNEL_ID);

        if (channel) {

            await channel.send({
                embeds: [
                    {
                        color: 0x00b894,
                        title: `🕌 ${prayerName} Prayer Time`,
                        description:
                            `It's time for ${prayerName} prayer.\n\n` +
                            `اَللّٰهُ أَكْبَرُ اَللّٰهُ أَكْبَرُ`,
                        timestamp: new Date(),
                        footer: {
                            text: `${CITY}, ${COUNTRY}`
                        }
                    }
                ]
            });

            console.log(`📢 Text notification sent`);
        }

        // Play in all occupied channels
        client.guilds.cache.forEach(guild => {

            const channels = getOccupiedVoiceChannels(guild);

            channels.forEach(channel => {
                playAzanInChannel(channel);
            });
        });

    } catch (error) {

        console.error('❌ sendAzan Error:', error);
    }
}


// =========================
// CHECK PRAYER TIME
// =========================

function checkPrayerTime() {

    const now = new Date();

    const currentTime =
        `${String(now.getHours()).padStart(2, '0')}:` +
        `${String(now.getMinutes()).padStart(2, '0')}`;

    const prayers = [
        'Fajr',
        'Dhuhr',
        'Asr',
        'Maghrib',
        'Isha'
    ];

    for (const prayer of prayers) {

        if (
            prayerTimes[prayer] &&
            prayerTimes[prayer].substring(0, 5) === currentTime
        ) {

            console.log(`🕌 Time for ${prayer}`);

            sendAzan(prayer);
        }
    }
}


// =========================
// READY
// =========================

client.once('ready', async () => {

    console.log(`✅ Logged in as ${client.user.tag}`);

    await registerCommands();

    await fetchPrayerTimes();

    // Update prayer times daily
    cron.schedule('0 0 * * *', async () => {

        console.log('🔄 Updating prayer times...');
        await fetchPrayerTimes();
    });

    // Check every minute
    cron.schedule('* * * * *', () => {
        checkPrayerTime();
    });

    console.log(`🕌 Azan bot active`);
    console.log(`📍 ${CITY}, ${COUNTRY}`);
    console.log(`🎵 Audio path: ${AZAN_AUDIO_PATH}`);
});


// =========================
// COMMANDS
// =========================

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // =====================
    // PRAYER TIMES
    // =====================

    if (commandName === 'prayertimes') {

        const msg =
            `🕌 **Prayer Times for ${CITY}, ${COUNTRY}**\n\n` +
            `🌅 Fajr: ${prayerTimes.Fajr || 'Loading'}\n` +
            `☀️ Dhuhr: ${prayerTimes.Dhuhr || 'Loading'}\n` +
            `🌤️ Asr: ${prayerTimes.Asr || 'Loading'}\n` +
            `🌆 Maghrib: ${prayerTimes.Maghrib || 'Loading'}\n` +
            `🌙 Isha: ${prayerTimes.Isha || 'Loading'}`;

        await interaction.reply(msg);
    }

    // =====================
    // NEXT PRAYER
    // =====================

    else if (commandName === 'nextprayer') {

        const now = new Date();

        const currentTime =
            `${String(now.getHours()).padStart(2, '0')}:` +
            `${String(now.getMinutes()).padStart(2, '0')}`;

        const prayers = [
            'Fajr',
            'Dhuhr',
            'Asr',
            'Maghrib',
            'Isha'
        ];

        let nextPrayer = null;

        for (const prayer of prayers) {

            if (
                prayerTimes[prayer] &&
                prayerTimes[prayer] > currentTime
            ) {

                nextPrayer = {
                    name: prayer,
                    time: prayerTimes[prayer]
                };

                break;
            }
        }

        // If all prayers passed today
        if (!nextPrayer) {

            nextPrayer = {
                name: 'Fajr',
                time: prayerTimes.Fajr
            };
        }

        await interaction.reply(
            `⏰ Next prayer: **${nextPrayer.name}** at **${nextPrayer.time}**`
        );
    }

    // =====================
    // TEST
    // =====================

    else if (commandName === 'test') {

        await interaction.reply({
            content: '🔔 Test azan triggered!',
            ephemeral: true
        });

        sendAzan('Test');
    }
});


// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);
