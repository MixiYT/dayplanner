# Сборка APK на Windows

## Что нужно

- Rust (rustup) и GNU-тулчейн `stable-x86_64-pc-windows-gnu`;
- Node.js 20+;
- JDK 17;
- Android SDK: платформы 36/37, build-tools 36/37;
- Android NDK `27.2.12479018`;
- MinGW из WinLibs: `winget install BrechtSanders.WinLibs.POSIX.UCRT`.

GNU-тулчейн нужен потому, что проект собирается без Visual Studio C++ Build Tools. Если MSVC-компоненты установлены, можно использовать и стандартный тулчейн, но скрипт ниже рассчитан на GNU.

## Быстрая сборка

```powershell
cd C:\путь\к\dayplanner
.\build-apk.ps1
```

Если PowerShell блокирует запуск скриптов:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-apk.ps1
```

Параметры:

| Команда | Что делает |
|---|---|
| `.\build-apk.ps1` | release-APK, arm64 + armv7 |
| `.\build-apk.ps1 -DebugBuild` | debug-APK (тоже устанавливается) |
| `.\build-apk.ps1 -AllAbis` | добавить x86 и x86_64 (для эмуляторов) |

Скрипт сам находит JDK 17, Android SDK, NDK, GNU-тулчейн Rust и MinGW, при необходимости ставит npm-зависимости, генерирует иконки и проект Android, затем копирует результат в:

```
dist\dayplanner-<версия>.apk
```

Переменные окружения меняются только внутри запущенного скрипта.

## Установка на телефон

По USB:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "dist\dayplanner-<версия>.apk"
```

Или скопируйте APK на телефон и откройте его, разрешив установку из неизвестных источников.

После первого запуска откройте **Настройки → Android** и выдайте разрешения: уведомления, точные будильники, полноэкранные уведомления, работа в фоне. Иначе напоминания могут срабатывать с задержкой.

## Подпись release-APK

В репозитории нет ключа подписи. Создайте свой:

```powershell
keytool -genkeypair -v -keystore keys\dayplanner-release.jks `
  -storetype PKCS12 -alias dayplanner -keyalg RSA -keysize 2048 -validity 10000
```

Пароли и alias сохраните. Затем добавьте подпись в сгенерированный проект `app/src-tauri/gen/android/app/build.gradle.kts`:

```kotlin
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

android {
    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            // ...
        }
    }
}
```

И создайте `app/src-tauri/gen/android/keystore.properties`:

```properties
storeFile=../../../../keys/dayplanner-release.jks
storePassword=<пароль>
keyAlias=dayplanner
keyPassword=<пароль>
```

`keys/` и `keystore.properties` уже исключены из git. Без этой настройки скрипт соберёт APK, но он будет без подписи (`-unsigned.apk`).

Ключ нужен, чтобы новые версии ставились поверх старых. Если ключ потерян, обновить приложение без удаления данных не получится.

## Ручная сборка без скрипта

Если окружение уже настроено в текущем терминале:

```powershell
cd app
npx tauri android build --apk --target aarch64 armv7
```

Без параметра `--target` соберутся все четыре архитектуры, APK будет больше.

## Замечания по проекту

- В `plugins/planner-native/android/build.gradle.kts` стоит `compileSdk = 36`: `tauri-android` требует минимум 36.
- Папка `app/src-tauri/gen/android` генерируется командой `npx tauri android init` и не хранится в git.
- Иконки генерируются из `app/app-icon.png` командой `npm run icons` и тоже не хранятся в git.

## Если что-то не собирается

- `link.exe not found` — используется MSVC-тулчейн без Visual Studio C++ Build Tools. Запускайте `build-apk.ps1` (он переключает на GNU) или установите компонент «Разработка классических приложений на C++».
- `dlltool.exe: program not found` — не найден MinGW. Установите: `winget install BrechtSanders.WinLibs.POSIX.UCRT`.
- `NDK was not found` — установите NDK: `sdkmanager "ndk;27.2.12479018"`.
- `requires compileSdk 36 or later` — у плагина в `plugins/planner-native/android/build.gradle.kts` должен стоять `compileSdk = 36` или выше.
- APK не устанавливается поверх старой версии — он подписан другим ключом. Удалите старую версию или используйте тот же `keys/dayplanner-release.jks`.
