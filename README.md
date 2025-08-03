# AI-Powered Next.js Development Tool

A sophisticated AI agent that can build and modify Next.js applications through natural language commands in isolated sandboxes.

## 🌟 Features

- **Natural Language Development**: Describe what you want to build, and the AI creates it
- **Isolated Sandboxes**: Each session runs in a secure E2B sandbox environment
- **Real-time Code Generation**: Watch your applications come to life instantly
- **Session Management**: Persistent conversations with memory across interactions
- **Pre-configured Stack**: Next.js 15.3.3 with Tailwind CSS, Shadcn/UI, and more

## 🏗️ Architecture

### Core Components

- **Frontend**: Next.js 15 with TypeScript and Tailwind CSS
- **AI Agent**: LangGraph-powered agent with OpenAI integration
- **Sandbox Environment**: E2B Code Interpreter for isolated execution
- **Queue Management**: Inngest for background job processing
- **State Management**: tRPC for type-safe API calls
- **Persistence**: MongoDB for conversation checkpointing

### Key Technologies

- **LangGraph**: For building the AI agent workflow
- **E2B Sandboxes**: Secure, isolated development environments
- **OpenAI/OpenRouter**: Multiple LLM provider support
- **Inngest**: Reliable background job processing
- **MongoDB**: Conversation state persistence
- **Langfuse**: AI observability and monitoring

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- MongoDB instance
- E2B API key
- OpenAI API key (or OpenRouter for alternative models)
- Inngest account

### Environment Variables

Create a `.env.local` file with the following variables:

```env
# E2B Sandbox
E2B_API_KEY=your_e2b_api_key

# AI Model Provider (choose one)
OPENAI_API_KEY=your_openai_api_key
# OR for OpenRouter (multiple models)
OPENROUTER_API_KEY=your_openrouter_api_key

# MongoDB for state persistence
MONGODB_URL=mongodb://localhost:27017/lovable

# Inngest for background jobs
INNGEST_EVENT_KEY=your_inngest_event_key
INNGEST_SIGNING_KEY=your_inngest_signing_key

# Langfuse for observability (optional)
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
LANGFUSE_BASEURL=https://cloud.langfuse.com

# Next.js
NEXT_PUBLIC_URL=http://localhost:3000
```

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ai-next-builder
```

2. Install dependencies:
```bash
npm install
```

3. Set up your environment variables (see above)

4. Start the development server:
```bash
npm run dev
```

5. Start Inngest for background processing:
```bash
npx inngest-cli@latest dev
```

## 📖 Usage

### Basic Usage

1. **Start a Session**: The app automatically creates a new sandbox session
2. **Make Requests**: Type what you want to build in natural language
3. **View Results**: Click the sandbox link to see your live application

### Example Commands

- "Create a landing page with a hero section and contact form"
- "Add a navigation bar with Home and About links"
- "Build a todo app with add, edit, and delete functionality"
- "Create a blog layout with sidebar and article list"
- "Add dark mode toggle to the existing page"

### Pre-built Examples

The interface includes quick-start buttons for common tasks:
- **Hello World**: Basic page setup
- **Add Navigation**: Header with links
- **Add Footer**: Bottom section with copyright
- **Contact Form**: Form with validation

## 🤖 AI Agent Capabilities

### Development Tools

The AI agent has access to three main tools:

1. **Terminal Execution** (`runInTerminal`)
   - Install npm packages
   - Run build commands
   - Execute shell scripts

2. **File Operations** (`createOrUpdateFiles`)
   - Create new files
   - Update existing files
   - Smart duplicate detection

3. **File Reading** (`readFiles`)
   - Read current file contents
   - Analyze existing code structure
   - Make informed modifications

### Intelligent Features

- **Loop Prevention**: Detects and prevents repetitive actions
- **Task Completion Detection**: Automatically recognizes when work is done
- **Message Filtering**: Optimizes conversation history for better performance
- **Error Handling**: Graceful recovery from common development issues

## 🔧 Configuration

### Model Selection

The system supports multiple AI models through OpenRouter:

```typescript
// In src/inngest/functions.ts
const llm = new ChatOpenAI({
  model: "qwen/qwen3-coder:free", // Current default
  // model: "deepseek/deepseek-r1-0528",
  // model: "openrouter/horizon-alpha",
  temperature: 0,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
});
```

### Sandbox Template

The E2B sandbox uses the "lovable-kaif-1try" template with:
- Next.js 15.3.3 pre-installed
- Tailwind CSS configured
- Shadcn/UI components available
- 15-minute timeout per session

## 📁 Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── inngest/       # Inngest webhook
│   │   └── trpc/          # tRPC endpoints
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main interface
├── components/            # Reusable components
│   └── ui/               # Shadcn/UI components
├── graph/                 # LangGraph definitions
│   ├── graph.ts          # Basic graph implementation
│   └── graph_final.ts    # Enhanced graph with optimization
├── inngest/              # Background job handlers
│   ├── client.ts         # Inngest client
│   ├── functions.ts      # AI agent function
│   └── utils.ts          # Sandbox utilities
├── lib/                  # Utility libraries
│   ├── checkpointer.ts   # MongoDB state persistence
│   ├── filterMessages.ts # Message optimization
│   ├── Prompt.ts         # AI system prompt
│   ├── toolClass.ts      # Tool base class
│   ├── type.ts           # TypeScript definitions
│   └── utils.ts          # General utilities
└── trpc/                 # tRPC configuration
    ├── client.tsx        # Client-side setup
    ├── routers/          # API route definitions
    └── server.tsx        # Server-side setup
```

## 🎯 Key Features Deep Dive

### Session Management

Each user session gets:
- Unique sandbox environment
- Persistent conversation thread
- Automatic cleanup after timeout
- Session restoration capability

### Smart Message Filtering

The system includes sophisticated message filtering to:
- Prevent infinite loops
- Compress conversation history
- Maintain context while optimizing performance
- Detect task completion automatically

### Tool Safety

Built-in safety measures:
- Parameter validation and correction
- Common error pattern detection
- Graceful failure handling
- Duplicate operation prevention

## 🚨 Important Notes

### Limitations

- **File Scope**: AI can only modify `app/page.tsx` by default (configurable)
- **No External APIs**: Sandboxes work with static/local data only
- **Image Restrictions**: No external image URLs (uses emojis/placeholders)
- **Server Components**: Never adds "use client" to layout.tsx

### Best Practices

- Be specific in your requests
- Start with simple features and build incrementally
- Use the session reset if you encounter issues
- Monitor the sandbox link for real-time changes

## 🔍 Monitoring & Debugging

### Langfuse Integration

When configured, Langfuse provides:
- Conversation tracing
- Performance metrics
- Error tracking
- Model usage analytics

### Console Logging

The system provides detailed logging for:
- Tool executions
- State changes
- Message filtering decisions
- Completion detection

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

[Add your license information here]

## 🆘 Support

For issues and questions:
1. Check the console logs for detailed error information
2. Verify all environment variables are correctly set
3. Ensure your E2B and AI provider credits are sufficient
4. Review the Inngest dashboard for job processing status

## 🔗 Related Links

- [E2B Documentation](https://e2b.dev/docs)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Inngest Documentation](https://www.inngest.com/docs)
- [Next.js 15 Documentation](https://nextjs.org/docs)
- [Shadcn/UI Components](https://ui.shadcn.com/)

---

Built with ❤️ using cutting-edge AI and web technologies.