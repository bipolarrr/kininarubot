import { REST, Routes } from "discord.js";
import { commandData } from "./commands";
import { loadConfig } from "./config";

async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  await rest.put(route, { body: commandData });
  const scope = config.guildId ? `guild ${config.guildId}` : "global";
  console.log(`Registered ${commandData.length} slash commands for ${scope}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
