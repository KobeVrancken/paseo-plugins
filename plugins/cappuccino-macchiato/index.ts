import type { PluginContext } from "@getpaseo/plugin";

export default function contribute(plugin: PluginContext) {
  plugin.addTheme({
    id: "macchiato",
    name: "Cappuccino Macchiato",
    appearance: "dark",
    colors: {
      background: "#24273a",
      foreground: "#cad3f5",
      raised: "#363a4f",
      control: "#494d64",
      border: "#494d64",
      accent: "#c6a0f6",
      mutedForeground: "#a5adcb",
      ring: "#6e738d",
    },
  });
  return () => {};
}
