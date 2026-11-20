# One image: the web app is built and served by the API from wwwroot (same origin, no CORS).

FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY backend/src/Engosoft.Learn.Api/Engosoft.Learn.Api.csproj backend/src/Engosoft.Learn.Api/
RUN dotnet restore backend/src/Engosoft.Learn.Api/Engosoft.Learn.Api.csproj
COPY backend/src/ backend/src/
RUN dotnet publish backend/src/Engosoft.Learn.Api/Engosoft.Learn.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
# Arabic dates and time zones need ICU and tzdata (both in the Debian base image).
ENV ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true
COPY --from=api /app ./
COPY --from=web /web/dist ./wwwroot
# Uploaded chat files and task submissions live here; mount a volume at /app/storage to keep them across deploys.
RUN mkdir -p /app/storage && chown -R app:app /app/storage
USER app
EXPOSE 8080
# Railway (and most hosts) pass the port in PORT.
CMD ["sh", "-c", "ASPNETCORE_HTTP_PORTS=${PORT:-8080} exec dotnet Engosoft.Learn.Api.dll"]
