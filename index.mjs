// Set PROD to true for the SE27 server, and false for the test server
const PROD = false;

if (!process.env.DISCORD_TOKEN) {
    console.error("ENV variable DISCORD_TOKEN not set");
    console.log("This is the discord bot token. Keep it private.");
    process.exit(1);
}

if (!process.env.NOTION_SECRET) {
    console.error("ENV variable NOTION_SECRET not set");
    console.log("This is the Notion API secret. Keep it private.");
    process.exit(1);
}

import { schedule } from "node-cron";
import { Client, GatewayIntentBits, Events, EmbedBuilder } from "discord.js";

const fetchTasks = async () => {
    let resp = await fetch(
        "https://api.notion.com/v1/databases/45fe8b30df134e5db7080b8f29aa5e9e/query",
        {
            method: "POST",
            headers: {
                Authorization: process.env.NOTION_SECRET,
                "Notion-Version": "2022-06-28",
            },
            body: JSON.stringify({}),
        }
    );
    let resp_json = await resp.json();

    let tasks = [];
    for (let page of resp_json.results) {
        // TODO: validate that both these fields exist
        tasks.push({
            name: page.properties.Name.title[0].plain_text,
            due: page.properties.Due.date.start,
        });
    }

    return tasks;
};

const getNotionDate = (date) => {
    // Check if timezone is included (it's uncanny how bad this is)
    // Notion will add the timezone to the date if the time is specified.
    // Otherwise, Notion will not add the timezone, so we shift by 4 hours for EST

    let hasTimezone = date.length == 10;

    const fourHours = 14400000;
    const oneDayMinusOneMinute = 86399000;

    return hasTimezone
        ? (new Date(date).getTime() + fourHours + oneDayMinusOneMinute) / 1000
        : new Date(date).getTime() / 1000;
};

const taskToEmbed = (task) => {
    let dueDate = getNotionDate(task.due);
    let hasTime = task.due.length == 10;

    return {
        name: task.name,
        // We display the time if it exists. see discord timestamp formatting
        value: !hasTime ? `<t:${dueDate}:f>` : `<t:${dueDate}:D>`,
        inline: false,
    };
};

const sendUpdate = async () => {
    let tasks = await fetchTasks();

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers,
        ],
    });

    client.once(Events.ClientReady, async (c) => {
        console.log(`Ready! Logged in as ${c.user.tag}`);

        const upcomingBucket = [];
        const longTermBucket = [];

        let ping = false;

        tasks.forEach((task) => {
            const taskDue = getNotionDate(task.due);
            const tdy = new Date();
            const today = tdy.getTime() / 1000;
            const todayDate = tdy.getDate();

            tdy.setDate(todayDate + 3);
            const threeDays = tdy.getTime() / 1000;
            tdy.setDate(todayDate + 7);
            const sevenDays = tdy.getTime() / 1000;

            if (taskDue >= today && taskDue <= threeDays) {
                upcomingBucket.push(taskToEmbed(task));
                if (taskDue - today <= 86400) ping = true;
            } else if (taskDue >= threeDays && taskDue <= sevenDays) {
                longTermBucket.push(taskToEmbed(task));
            }
        });

        let channel = await c.channels.fetch(
            PROD ? "1088326374764326964" : "869951873749254228"
        );

        const embed = new EmbedBuilder()
            .setColor(0xcf2b2b)
            .setTitle("Upcoming Due Dates!")
            .addFields(upcomingBucket);
        const embed2 = new EmbedBuilder()
            .setColor(0xe0d019)
            .setTitle("Next 7 Days")
            .addFields(longTermBucket);

        if (ping) {
            await channel.send("<@&1088328245390348338>");
        }
        await channel.send({ embeds: [embed, embed2] });
    });

    client.login(process.env.DISCORD_TOKEN);
};

// Runs at 4PM EST every day. See chron syntax.
schedule("0 20 * * *", async () => {
    console.log("[INFO] Sending upcoming tasks...");
    await sendUpdate();
});

// To send a test update upon booting
// sendUpdate();
