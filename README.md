# InfoCoffee Analytics Platform

A comprehensive coffee business analytics platform integrating with Vendista API, featuring a Telegram Mini App interface, real-time monitoring, and automated task management.

## 🏗️ Architecture

**Monorepo Structure:**
- `backend/` - Node.js Express API server with Telegram bot
- `frontend/` - React Telegram Mini App
- `ecosystem.config.js` - PM2 production configuration
- `docker-compose.yml` - Development PostgreSQL setup

**Production Architecture:**
- **infocoffee-backend** - Main API server + Telegram Bot + Monitoring
- **infocoffee-scheduler** - Cron jobs + Data import + Terminal sync

## 📚 API Documentation

**Detailed API documentation available in separate files:**
- **Backend API** - `ReadMe/API_Backend.txt` (433 lines) - Complete REST API reference with examples
- **Frontend API** - `ReadMe/API_Frontend.txt` (78 lines) - Frontend integration patterns
- **Database Schema** - `ReadMe/DB.txt` (476 lines) - Full PostgreSQL schema documentation

## 🚀 Quick Start

### Development Mode
```bash
# Install dependencies
npm run install:all

# Start development servers
npm run dev
# Frontend: http://localhost:3000 + DevEntry for role testing
# Backend: http://localhost:3001/api
```

### Production Deployment
```bash
# Deploy to production
./deploy.sh

# Or manual PM2 management
pm2 start ecosystem.config.js
pm2 save
```

## 🔧 Environment Configuration

### Development (.env.development)
- Telegram dev bot tokens
- Local database connection
- Dev role emulation settings
- Skip hash validation

### Production (.env)
- Production Telegram bot tokens
- Production database credentials
- Encryption keys
- Vendista API configuration

**Key Variables:**
```env
NODE_ENV=production|development
TELEGRAM_BOT_TOKEN=your_bot_token
PGUSER=coffee_admin
PGDATABASE=coffee_dashboard
JWT_SECRET=your_secret
ENCRYPTION_KEY=your_key
VENDISTA_API_BASE_URL=https://api.vendista.ru:99
```

## 🔐 Authentication & Authorization

### Access Levels
- **Owner** - Full system access, business management
- **Admin** - Task management, analytics access  
- **Service** - Task execution only

### Token Flow
1. Telegram Mini App validates user via initData
2. Backend generates JWT with user role
3. All API calls require Bearer token
4. Middleware validates token and permissions

### Dev Mode Features
- Role emulation via DevEntryPage
- Skip Telegram hash validation  
- Test user IDs for role testing

## 🤖 Telegram Bot System

### Core Features
- **Rate-limited queuing** - Handles 100+ users without API limits
- **Priority messaging** - Critical notifications bypass queue
- **Auto-retry** - Failed messages retry with exponential backoff
- **Bulk notifications** - Batched sending for efficiency

### Message Types
- Task assignments with inline keyboards
- Critical error notifications
- Financial summaries
- System status updates

### Monitoring
- Queue statistics every minute
- Health checks every 60 seconds
- Performance metrics every 5 minutes
- API endpoint: `/api/bot-status`

## 📊 Background Workers

### Schedule Imports (`schedule_imports.js`)
- **15-min imports** - Recent transaction sync
- **Daily imports** - 72-hour deep sync (Mon-Sat 23:05 MSK)
- **Weekly imports** - 8-day full sync (Sun 23:10 MSK)
- **Terminal sync** - Equipment status every 15 minutes

### Task Management
- **Auto-task creation** - Based on inventory levels and sales
- **Role-based assignment** - Cleaning/restocking by user role
- **Batch notifications** - Grouped by assignee for efficiency

### Error Handling
- **Admin notifications** - Spam-protected error reporting
- **Payment tracking** - Vendista payment status monitoring
- **Retry logic** - Automatic retry with backoff

## 🗄️ Database Schema

### Core Tables
- `users` - Business owners and staff
- `terminals` - Coffee machine equipment
- `transactions` - Sales data from Vendista
- `inventories` - Stock levels (warehouse + machines)
- `service_tasks` - Maintenance assignments
- `recipes` - Drink configurations
- `expenses` - Business expense tracking

### Key Features
- **Encryption** - Sensitive data (API tokens) encrypted at rest
- **Audit logs** - Full change tracking for inventory
- **Optimized queries** - Complex analytics with performance indexes

## 🎨 Frontend Architecture

### Core Components
- **AuthProvider** - JWT token management
- **MainDashboardLayout** - Responsive layout with navigation
- **StandDetail** - Terminal management (stock, recipes, settings)
- **Modal System** - Consistent UI with MobileFirst design

### Development Tools
- **DevEntryPage** - Role switching for testing
- **Mock Telegram** - WebApp emulation in browser
- **Environment detection** - Production-safe dev features

### Build Process
- React production build with API URL injection
- Version cache-busting for updates
- Rsync deployment to web root

## ⚙️ Production Operations

### PM2 Management
```bash
# Start services
pm2 start ecosystem.config.js

# Monitor status
pm2 list
pm2 monit

# View logs
pm2 logs --follow
pm2 logs infocoffee-backend --lines 100

# Restart with new environment
pm2 restart ecosystem.config.js --update-env
```

### Health Monitoring
```bash
# System status
curl http://localhost:3001/api/bot-status

# Database connection
pm2 logs infocoffee-backend | grep "DATABASE"

# Queue performance
pm2 logs | grep "BotQueue Stats"
```

### Troubleshooting
```bash
# Check environment variables
pm2 env 0  # backend process
pm2 env 1  # scheduler process

# Verify .env loading
pm2 logs | grep "Production mode detected"

# Restart failed processes
pm2 restart all --update-env
```

## 🔒 Security Considerations

### Data Protection
- API tokens encrypted with AES-256-CBC
- JWT tokens with expiration
- SQL injection protection via parameterized queries
- CORS configuration for Telegram domains

### Production Hardening
- Environment separation (dev/prod .env files)
- Process isolation via PM2
- Database credentials in environment only
- No sensitive data in logs

## 🧪 Testing & Development

### Role Testing
1. Access DevEntryPage in development
2. Select role (Owner/Admin/Service)  
3. Test specific functionality per role
4. Use "Выйти (Дев)" to switch roles

### API Testing
- Complete API documentation in dedicated files (see API Documentation section)
- Postman-compatible endpoint definitions
- Role-based endpoint access testing

### Database Development
- Local PostgreSQL via Docker Compose
- Complete schema documentation available (see API Documentation section)
- Migration and seeding procedures

## 📈 Performance & Scaling

### Current Capacity
- **100+ concurrent users** supported
- **Rate-limited messaging** prevents API blocks
- **Efficient queuing** with priority handling
- **Batched operations** for bulk actions

### Optimization Features
- Connection pooling for database
- Message deduplication
- Smart retry logic with backoff
- Memory usage monitoring

## 🔄 Deployment Pipeline

1. **Code changes** - Push to GitHub repository
2. **Server sync** - `git pull` on production server  
3. **Dependencies** - Automatic npm install if package.json changed
4. **Frontend build** - Production React build with API URLs
5. **File sync** - Rsync to web root with permissions
6. **Service restart** - PM2 restart via ecosystem.config.js
7. **Health check** - Verify all processes running

## 📝 Key Files Reference

- `ecosystem.config.js` - PM2 production configuration
- `deploy.sh` - Automated deployment script
- `backend/app.js` - Main server with bot integration
- `backend/bot.js` - Telegram bot logic and commands
- `backend/utils/botQueue.js` - Message queuing system
- `frontend/src/App.js` - Main React app with auth
- `frontend/src/utils/dev.js` - Development utilities

---

**Built for scale. Designed for reliability. Optimized for coffee businesses.** 