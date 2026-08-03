import { AppShellView } from "./AppShellView";
import { useAppController } from "./useAppController";

export function App() {
  return <AppShellView controller={useAppController()} />;
}
