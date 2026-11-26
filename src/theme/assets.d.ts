// Metro turns a font import into an asset id (a number) that `expo-font` loads. Expo's ambient
// types (`expo-env.d.ts`) declare CSS modules but not fonts, so this file does.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
