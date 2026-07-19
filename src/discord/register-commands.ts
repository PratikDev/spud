import { REST, Routes } from "discord.js";

import { env } from "@/env";
import { commands } from "./commands";

const rest = new REST().setToken(env.DISCORD_TOKEN);

const body = commands.map((command) => command.data.toJSON());

await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });

console.log(`Registered ${body.length} slash command(s).`);
