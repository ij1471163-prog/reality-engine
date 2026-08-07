package com.naif.realityengine;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private static final int PICK_FILE = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        Button btnPickFile = findViewById(R.id.btnPickFile);
        Button btnHistory  = findViewById(R.id.btnHistory);

        btnPickFile.setOnClickListener(v -> pickFile());

        btnHistory.setOnClickListener(v ->
            Toast.makeText(this, "السجل — قريباً", Toast.LENGTH_SHORT).show()
        );

        // لو فُتح التطبيق من ملف
        handleIncomingFile(getIntent());
    }

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("text/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(intent, PICK_FILE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null) {
            openAnalysis(data.getData());
        }
    }

    private void handleIncomingFile(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            Uri uri = intent.getData();
            if (uri != null) openAnalysis(uri);
        }
    }

    private void openAnalysis(Uri uri) {
        Intent intent = new Intent(this, AnalysisActivity.class);
        intent.setData(uri);
        startActivity(intent);
    }
}
