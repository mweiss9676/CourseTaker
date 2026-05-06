# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Cameron Mitchell Restaurants (CMR) Gift Card** e-commerce platform — a full-stack ASP.NET Core 5.0 application with a React/TypeScript SPA, SQL Server database, and multiple satellite worker applications for order processing and FTP integrations.

## Build & Run Commands

**Run the app (primary workflow):**
```powershell
./start.ps1    # Builds Domain, then runs dotnet watch on Web/
```

**Database migrations** (Rake, run from repo root):
```bash
rake db:migrate   # Run FluentMigrator, scaffold EF models, regenerate partial classes
rake swagger      # Generate Swagger/OpenAPI specs
```

**Frontend** (from `Web/ClientApp`):
```bash
npm run build    # Production webpack bundle
npm run nswag    # Regenerate TypeScript API clients from Swagger
```

**Regenerate TypeScript clients after API changes:**
Run `rake swagger` first (regenerates the Swagger JSON spec), then run `nswag-client-generator.bat` at the repo root (runs `npm run nswag` to generate TypeScript clients from the spec). Both steps are required.

**Tests:**
```bash
dotnet test Tests/Tests.csproj --filter "FullyQualifiedName~Fraud"
```

Only the fraud tests are actively maintained. Do not run the full test suite — other tests have fallen out of date and will fail.

## Architecture

### Solution Layout

| Project | Purpose |
|---|---|
| `Domain/` | Shared library: EF Core models, services, DTOs, validators, mappers |
| `Web/` | ASP.NET Core host: REST API + React SPA |
| `Migrations/` | FluentMigrator database schema versioning |
| `DbScaffolder/` | Utility that regenerates EF Core models from the live DB schema |
| `Importer.Orders/`, `Importer.OrdersToo/`, etc. | Worker services for order processing |
| `Ftp.Paytronix/` | FTP integration with the Paytronix loyalty platform |
| `Tests/` | xUnit test suite |
| `Tasks/Rake/` | All Rake build task definitions |

### Backend Architecture

**Domain** is the core library consumed by Web and all Importer apps. Key sub-structures:

- `Domain/Models/` — EF Core entities. `WebContext.cs` is the DbContext; `WebContextEntities.cs` is scaffolded (do not edit by hand — run `rake db:migrate` to regenerate). Add customizations in `Models/Partial/`.
- `Domain/Services/` — ~50+ business logic services (payments via Authorize.NET, shipping via Stamps.com, email via Mailgun/FluentEmail, SMS via Twilio, FTP via FluentFTP, etc.)
- `Domain/ControllerServices/` — Layer between API controllers and services; mirrors the `Areas/Api/` structure.
- `Domain/Startup/StartupExtensions.cs` — All DI registrations (100+ bindings). Register new services here.
- `Domain/HtmlTemplates/` — Razor `.cshtml` templates for emails and PDFs rendered server-side.

**Web** is the ASP.NET Core host:
- `Web/Areas/Api/` — REST API controllers (thin; delegate to ControllerServices)
- `Web/Areas/Identity/` — ASP.NET Identity pages
- `Web/Controllers/` — MVC controllers (HomeController, AdminController)
- `Web/ClientApp/` — React SPA source (see Frontend section)

### Frontend Architecture

Located in `Web/ClientApp/src/`:

- `clients/` — **Auto-generated** TypeScript API clients via NSwag. Regenerate with `npm run nswag` after API changes; do not edit by hand.
- `features/` — Feature modules (admin, products, orders, checkout, etc.)
- `store/` — Redux Toolkit slices and store configuration
- `common/` — Shared UI components and styles
- `hooks/` — Custom React hooks
- `models/` — TypeScript interfaces
- `helpers/` — Utility functions

State management uses Redux Toolkit. UI components come from Ant Design 4. Routing uses React Router 5.

### Database

- **SQL Server**, local instance: `(local)\CMR_Development`, database `CMR_Development`
- Schema versioned via **FluentMigrator** in `Migrations/`; migrations run automatically on startup via `app.ApplyMigrations()` in `Startup.cs`
- EF Core with lazy-loading proxies enabled

### Background Jobs

Hangfire with SQL Server backing schedules background work: order imports from Paytronix, Great Plains ERP batch processing, email/SMS notifications, cart cleanup. Dashboard at `/hangfire`.

### External Integrations

| Integration | Purpose |
|---|---|
| Authorize.NET | Payment processing (hosted form) |
| Stamps.com | Shipping label generation & address validation |
| Paytronix | Loyalty platform (FTP batch exchange) |
| Great Plains | ERP sync (FTP) |
| Mailgun / Gmail | Email (via FluentEmail) |
| Twilio | SMS notifications |
| Seq | Centralized structured logging |

## Key Patterns

- **ControllerServices pattern**: API controllers are thin and delegate to a matching `ControllerService` in `Domain/ControllerServices/`.
- **Service abstraction**: Never inject `WebContext` directly into ControllerServices or other Services. Always go through a typed service (e.g., `IFraudRuleService`, `IOrderService`). `WebContext` belongs only inside `AppService<T>` subclasses and low-level domain services that own a specific entity. When a new table is added via migration and the scaffolder runs, a generated `IXxxService` / `XxxService` pair appears in `Domain/Services/Generated/` — use those.
- **Scaffolded models**: `WebContextEntities.cs` is generated — never edit it. Use `Partial/` classes for extensions that are NOT coming from the database (computed properties, interface implementations, etc.). Do NOT add properties to `Partial/` classes just because a migration hasn't run yet — `rake db:migrate` runs the migration AND regenerates `WebContextEntities.cs`, so the property will appear there automatically. Adding it to a partial first creates a duplicate property error after the next scaffolder run.
- **NSwag code generation**: `Web/ClientApp/src/clients/` is generated from Swagger. Run `npm run nswag` to update after API changes.
- **FluentValidation**: Validators live in `Domain/Validators/` and are registered via DI.
- **AutoMapper**: Profiles in `Domain/Mappers/`; registered at startup.
- **Async throughout**: All service methods and controllers use async/await.
