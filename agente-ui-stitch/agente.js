import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `Eres un Ingeniero Frontend y Experto en UX/UI.
Tu objetivo es traducir los requerimientos del usuario en interfaces funcionales usando las herramientas de Stitch.
Reglas:
1. Analiza el requerimiento y decide qué herramientas usar.
2. Si una herramienta falla, lee el error, ajusta los parámetros y vuelve a intentarlo.
3. Informa al usuario de tus acciones de forma concisa.`;

const USER_PROMPT = `Crea un proyecto nuevo y genera una pantalla de inicio de sesión con un botón azul oscuro,
que reciba usuario y contraseña, y que tenga las opciones "Registrarse", "Olvidé mi contraseña"
y una casilla "Recordar sesión".`;

async function iniciarAgente() {
  console.log("🔌 Iniciando conexión con Stitch MCP...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "stitch-mcp-stdio"],
    env: { ...process.env, STITCH_API_KEY: process.env.STITCH_API_KEY },
  });

  const mcpClient = new Client({ name: "agente-stitch", version: "1.0" }, { capabilities: {} });
  await mcpClient.connect(transport);

  const mcpTools = await mcpClient.listTools();
  const openRouterTools = mcpTools.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  console.log(`✅ Conexión exitosa. ${openRouterTools.length} herramientas disponibles.`);

  const mensajes = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: USER_PROMPT },
  ];
  let tareaCompletada = false;
  let iteraciones = 0;
  const MAX_ITERACIONES = 15;

  while (!tareaCompletada && iteraciones < MAX_ITERACIONES) {
    iteraciones++;
    const respuesta = await openai.chat.completions.create({
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      messages: mensajes,
      tools: openRouterTools,
    });

    const mensajeModelo = respuesta.choices[0].message;
    mensajes.push(mensajeModelo);

    if (mensajeModelo.tool_calls && mensajeModelo.tool_calls.length > 0) {
      for (const toolCall of mensajeModelo.tool_calls) {
        console.log(`🛠 Acción del Agente -> Ejecutando: ${toolCall.function.name}`);
        try {
          const argumentos = JSON.parse(toolCall.function.arguments || "{}");
          const resultado = await mcpClient.callTool(
  { name: toolCall.function.name, arguments: argumentos },
  undefined,
  { timeout: 300000 }
);
          mensajes.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(resultado),
          });
          console.log("✅ Acción completada con éxito.");
        } catch (error) {
          console.log(`⚠️ Error en la herramienta: ${error.message}. Informando al agente para que corrija...`);
          mensajes.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Error: ${error.message}`,
          });
        }
      }
        } else if (!mensajeModelo.content) {
      console.log("↩️ Respuesta vacía, pidiendo al agente que continúe...");
      mensajes.push({
        role: "user",
        content: "Continúa: aún falta generar la pantalla de inicio de sesión en el proyecto que creaste.",
      });
    } else {
      console.log(`\n🎉 Agente: ${mensajeModelo.content}`);
      tareaCompletada = true;
    }
  }

  if (!tareaCompletada) console.log("⏹ Se alcanzó el límite de iteraciones.");
  await mcpClient.close();
}

iniciarAgente().catch(console.error);