<script lang="ts">
  import { onMount, tick } from "svelte";
  import { appSettings } from "../lib/stores";

  interface Message {
    id: number;
    role: "user" | "assistant";
    content: string;
    sql?: string | null;
    loading?: boolean;
    error?: boolean;
  }

  let messages: Message[] = [];
  let input = "";
  let sending = false;
  let chatContainer: HTMLDivElement;
  let inputEl: HTMLTextAreaElement;
  let nextId = 1;
  let showSql: Record<number, boolean> = {};

  const suggestions = [
    "Who has birthdays this month?",
    "How many active employees do we have?",
    "Which jobs are over budget?",
    "Who's on the bench right now?",
    "What's our most profitable active job?",
    "Show me the license ratio on each active job",
    "Any driver's licenses expiring in the next 60 days?",
    "What open action items are marked urgent?",
  ];

  onMount(() => {
    inputEl?.focus();
  });

  async function scrollToBottom() {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  async function sendMessage(text?: string) {
    const msg = (text || input).trim();
    if (!msg || sending) return;
    input = "";

    // Add user message
    const userMsg: Message = { id: nextId++, role: "user", content: msg };
    messages = [...messages, userMsg];

    // Add loading placeholder
    const loadingId = nextId++;
    const loadingMsg: Message = { id: loadingId, role: "assistant", content: "", loading: true };
    messages = [...messages, loadingMsg];
    sending = true;
    await scrollToBottom();

    try {
      // Build history (exclude loading messages)
      const history = messages
        .filter(m => !m.loading && !m.error)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "BirdDog" },
        credentials: "include",
        body: JSON.stringify({ message: msg, history: history.slice(0, -1) }),
      });

      const data = await res.json();

      if (!res.ok) {
        messages = messages.map(m =>
          m.id === loadingId
            ? { ...m, content: data.error || "Something went wrong.", loading: false, error: true }
            : m
        );
      } else {
        messages = messages.map(m =>
          m.id === loadingId
            ? { ...m, content: data.answer, sql: data.sql, loading: false }
            : m
        );
      }
    } catch (err: any) {
      messages = messages.map(m =>
        m.id === loadingId
          ? { ...m, content: "Network error. Please try again.", loading: false, error: true }
          : m
      );
    }

    sending = false;
    await scrollToBottom();
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function toggleSql(id: number) {
    showSql = { ...showSql, [id]: !showSql[id] };
  }

  function clearChat() {
    messages = [];
    showSql = {};
  }
</script>

<div class="flex flex-col h-[calc(100vh-5rem)] max-w-3xl mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between py-3 px-1">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-lg font-bold shadow-md">
        AI
      </div>
      <div>
        <h1 class="text-lg font-bold leading-tight">BirdDog AI</h1>
        <p class="text-xs text-base-content/50">Ask anything about your {$appSettings.companyName || 'company'} data</p>
      </div>
    </div>
    {#if messages.length > 0}
      <button class="btn btn-xs btn-ghost text-base-content/40" on:click={clearChat}>Clear</button>
    {/if}
  </div>

  <!-- Chat area -->
  <div
    bind:this={chatContainer}
    class="flex-1 overflow-y-auto space-y-4 px-1 pb-4"
  >
    {#if messages.length === 0}
      <!-- Empty state with suggestions -->
      <div class="flex flex-col items-center justify-center h-full text-center px-4">
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-3xl mb-4">
          🔍
        </div>
        <h2 class="text-xl font-bold mb-1">Ask me anything</h2>
        <p class="text-sm text-base-content/50 mb-6 max-w-md">
          I can look up employee info, job details, assignments, birthdays, license counts — anything in your database.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
          {#each suggestions as suggestion}
            <button
              class="btn btn-sm btn-outline btn-primary text-left justify-start font-normal h-auto py-2.5 px-3"
              on:click={() => sendMessage(suggestion)}
            >
              {suggestion}
            </button>
          {/each}
        </div>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        <div class="flex gap-3" class:justify-end={msg.role === "user"}>
          {#if msg.role === "assistant"}
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5 shadow-sm">
              AI
            </div>
          {/if}

          <div
            class="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed {msg.error ? 'bg-error bg-opacity-10' : ''}"
            class:bg-primary={msg.role === "user"}
            class:text-primary-content={msg.role === "user"}
            class:bg-base-200={msg.role === "assistant" && !msg.error}
          >
            {#if msg.loading}
              <div class="flex items-center gap-2">
                <span class="loading loading-dots loading-sm text-primary"></span>
                <span class="text-base-content/50 text-xs">Thinking...</span>
              </div>
            {:else}
              <div class="whitespace-pre-wrap">{msg.content}</div>
              {#if msg.sql}
                <button
                  class="text-xs text-primary/60 hover:text-primary mt-2 flex items-center gap-1"
                  on:click={() => toggleSql(msg.id)}
                >
                  {showSql[msg.id] ? "Hide" : "Show"} SQL
                </button>
                {#if showSql[msg.id]}
                  <pre class="mt-1 text-xs bg-base-300/50 rounded-lg p-2 overflow-x-auto font-mono text-base-content/70">{msg.sql}</pre>
                {/if}
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Input area -->
  <div class="border-t border-base-300 pt-3 pb-2 px-1">
    <form on:submit|preventDefault={() => sendMessage()} class="flex gap-2 items-end">
      <textarea
        bind:this={inputEl}
        bind:value={input}
        on:keydown={handleKeydown}
        placeholder="Ask about your employees, jobs, assignments..."
        class="textarea textarea-bordered flex-1 min-h-[44px] max-h-32 resize-none text-sm leading-relaxed"
        rows="1"
        disabled={sending}
      />
      <button
        type="submit"
        class="btn btn-primary btn-sm h-[44px] px-4"
        disabled={!input.trim() || sending}
      >
        {#if sending}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          Send
        {/if}
      </button>
    </form>
    <p class="text-[10px] text-base-content/30 mt-1.5 text-center">
      BirdDog AI reads your database to answer questions. It cannot modify any data.
    </p>
  </div>
</div>
