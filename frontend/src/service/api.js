export async function fetchAiChatResponse() {
  const res = await fetch(`/api`);

  const data = await res.json();

  console.log(data);
  return data;
}
