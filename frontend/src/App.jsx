import { Outlet } from "react-router-dom";
import { fetchAiChatResponse } from "./service/api";

fetchAiChatResponse();
function App() {
  return (
    <>
      <Outlet />
    </>
  );
}

export default App;
