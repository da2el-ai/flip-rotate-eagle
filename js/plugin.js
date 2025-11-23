// 設定の保存・読み込み
const STORAGE_KEY = "fliprotate_settings";

function saveSettings(format, quality, saveMode) {
  const settings = { format, quality, saveMode };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }
  return { format: "webp", quality: "0.9", saveMode: "new" };
}

// 画像処理関数
async function processImage(imagePath, action, format, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");

        // 回転の場合は幅と高さを入れ替える必要がある
        if (action === "rotate-90" || action === "rotate-270") {
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        // 変換の中心を設定
        ctx.translate(canvas.width / 2, canvas.height / 2);

        // アクションに応じて変換を適用
        switch (action) {
          case "flip-horizontal":
            ctx.scale(-1, 1);
            break;
          case "flip-vertical":
            ctx.scale(1, -1);
            break;
          case "rotate-90":
            ctx.rotate((90 * Math.PI) / 180);
            break;
          case "rotate-180":
            ctx.rotate((180 * Math.PI) / 180);
            break;
          case "rotate-270":
            ctx.rotate((270 * Math.PI) / 180);
            break;
        }

        // 画像を描画（中心に配置）
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        // フォーマットに応じたMIMEタイプ
        let mimeType;
        switch (format) {
          case "png":
            mimeType = "image/png";
            break;
          case "jpeg":
            mimeType = "image/jpeg";
            break;
          case "bmp":
            mimeType = "image/bmp";
            break;
          case "webp":
          default:
            mimeType = "image/webp";
            break;
        }

        // canvasをBlobに変換
        // JPEG: ユーザーが選択した品質設定を適用（不可逆圧縮）
        // WebP: 品質1.0に固定（最高品質）
        // PNG/BMP: 品質設定なし（可逆圧縮）
        let qualityValue;
        if (format === "jpeg") {
          qualityValue = parseFloat(quality);
        } else if (format === "webp") {
          qualityValue = 1.0;
        } else {
          qualityValue = undefined;
        }

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Failed to create blob"));
            }
          },
          mimeType,
          qualityValue
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = "file://" + imagePath;
  });
}

// 画像を処理して保存
async function processAndSaveImage(item, action, format, quality, saveMode) {
  try {
    // 上書き保存の場合は元のファイル形式を使う
    let actualFormat = format;
    if (saveMode === "overwrite") {
      const path = require("path");
      const ext = item.ext || (item.name ? item.name.split(".").pop() : "");
      // 拡張子から適切なフォーマットを判断
      switch (ext.toLowerCase()) {
        case "jpg":
        case "jpeg":
          actualFormat = "jpeg";
          break;
        case "png":
          actualFormat = "png";
          break;
        case "webp":
          actualFormat = "webp";
          break;
        case "bmp":
          actualFormat = "bmp";
          break;
        default:
          // デフォルトは元の形式を維持（認識できない場合はwebp）
          actualFormat = ext.toLowerCase() || "webp";
      }
    }

    const blob = await processImage(
      item.filePath,
      action,
      actualFormat,
      quality
    );

    // BlobをArrayBufferに変換
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (saveMode === "overwrite") {
      // 上書きモード：元のファイルを上書き
      const path = require("path");
      const fs = require("fs");

      // 元のファイルを上書き
      fs.writeFileSync(item.filePath, buffer);

      // Eagleにリフレッシュを通知（APIがあれば）
      try {
        await eagle.item.refreshPalette(item.id);
        await eagle.item.refreshThumbnail(item.id);
      } catch (e) {
        console.warn("Failed to refresh item:", e);
      }

      return { success: true, path: item.filePath, mode: "overwrite" };
    } else {
      // 新規保存モード：一時ファイルを作成してEagleに追加
      const path = require("path");
      const fs = require("fs");
      const originalExt = path.extname(item.filePath);
      const newExt = "." + format;
      const baseName = path.basename(item.filePath, originalExt);

      // 一時ファイルフォルダを取得
      const tempDir = await eagle.app.getPath("temp");

      let newPath = path.join(tempDir, baseName + newExt);

      // ファイル名が重複する場合は番号を付ける
      let counter = 1;
      while (fs.existsSync(newPath)) {
        newPath = path.join(tempDir, `${baseName}_${counter}${newExt}`);
        counter++;
      }

      // ファイルを保存
      fs.writeFileSync(newPath, buffer);

      // Eagleに新しいファイルを追加
      await eagle.item.addFromPath(newPath);

      // 一時ファイルを削除
      try {
        fs.unlinkSync(newPath);
      } catch (e) {
        console.warn("Failed to delete temp file:", newPath, e);
      }

      return { success: true, path: newPath, mode: "new" };
    }

    return { success: true, path: newPath };
  } catch (error) {
    console.error("Error processing image:", item.filePath, error);
    return { success: false, error: error.message, path: item.filePath };
  }
}

// eagle.onPluginCreate((plugin) => {
//   console.log("FlipRotate plugin created");
// });

eagle.onPluginRun(async () => {
//   console.log("FlipRotate plugin running");

  // 設定を読み込んで復元
  const settings = loadSettings();
  const formatSelect = document.getElementById("format-select");
  const qualitySelect = document.getElementById("quality-select");
  const qualityGroup = document.getElementById("quality-group");
  const formatRow = document.getElementById("format-row");
  const overwriteRadio = document.getElementById("overwrite-radio");
  const newRadio = document.getElementById("new-radio");

  formatSelect.value = settings.format;
  qualitySelect.value = settings.quality;
  // ウィンドウを最前面に
  await eagle.window.setAlwaysOnTop(true);

  // saveModeの復元
  if (settings.saveMode === "overwrite") {
    overwriteRadio.checked = true;
  } else {
    newRadio.checked = true;
  }

  // saveModeを取得する関数
  function getSaveMode() {
    return overwriteRadio.checked ? "overwrite" : "new";
  }

  // 保存方式に応じてフォーマット行の表示/非表示を切り替える
  function updateFormatRowVisibility() {
    const saveMode = getSaveMode();
    if (saveMode === "overwrite") {
      // 上書き保存の場合は非表示
      formatRow.style.display = "none";
    } else {
      // 新規保存の場合は表示
      formatRow.style.display = "";
    }
  }

  // フォーマット変更時の処理
  function updateQualityVisibility() {
    if (formatSelect.value === "jpeg") {
      qualityGroup.classList.add("visible");
    } else {
      qualityGroup.classList.remove("visible");
    }
    saveSettings(formatSelect.value, qualitySelect.value, getSaveMode());
  }

  formatSelect.addEventListener("change", updateQualityVisibility);
  qualitySelect.addEventListener("change", () => {
    saveSettings(formatSelect.value, qualitySelect.value, getSaveMode());
  });

  // ラジオボタンの変更イベント
  overwriteRadio.addEventListener("change", () => {
    updateFormatRowVisibility();
    saveSettings(formatSelect.value, qualitySelect.value, getSaveMode());
  });
  newRadio.addEventListener("change", () => {
    updateFormatRowVisibility();
    saveSettings(formatSelect.value, qualitySelect.value, getSaveMode());
  });

  // 初期表示
  updateFormatRowVisibility();
  updateQualityVisibility();

  // ボタンのクリックイベント
  const buttons = document.querySelectorAll(".action-button");
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const format = formatSelect.value;
      const quality = qualitySelect.value;
      const saveMode = getSaveMode();

      // 選択された画像を取得
      const selectedItems = await eagle.item.getSelected();

      if (!selectedItems || selectedItems.length === 0) {
        alert("画像が選択されていません");
        return;
      }

      // 画像のみをフィルタ
      const imageItems = selectedItems.filter((item) => {
        // extにはドットが付いていない（例: "webp", "png"）
        const ext = item.ext || (item.name ? item.name.split(".").pop() : "");
        return (
          ext &&
          ["jpg", "jpeg", "png", "webp", "bmp", "gif"].includes(
            ext.toLowerCase()
          )
        );
      });

      if (imageItems.length === 0) {
        alert("画像ファイルが選択されていません");
        return;
      }

      // 設定を保存
      saveSettings(format, quality, saveMode);

      // 全てのボタンを無効化
      buttons.forEach((btn) => {
        btn.style.opacity = "0.5";
        btn.disabled = true;
      });

      // 処理実行
      let successCount = 0;
      let failCount = 0;

      for (const item of imageItems) {
        const result = await processAndSaveImage(
          item,
          action,
          format,
          quality,
          saveMode
        );
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      // 結果を通知して終了（ウィンドウは手動で閉じてもらう）
      if (failCount > 0) {
        alert(`処理完了\n成功: ${successCount}件\n失敗: ${failCount}件`);
      } else {
        alert(`${successCount}件の画像を処理しました`);
      }

      // ボタンを再有効化
      buttons.forEach((btn) => {
        btn.style.opacity = "1";
        btn.disabled = false;
      });
    });
  });
});

// eagle.onPluginShow(() => {
//   console.log("FlipRotate plugin shown");
// });

// eagle.onPluginHide(() => {
//   console.log("FlipRotate plugin hidden");
// });

// eagle.onPluginBeforeExit((event) => {
//   console.log("FlipRotate plugin exiting");
// });
